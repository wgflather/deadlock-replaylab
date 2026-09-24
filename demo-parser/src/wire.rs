//! Reads protobuf messages by field number, without a schema.
//!
//! The event messages this parser wants -- a hero's death, an ability cast -- are newer
//! than the protobuf definitions haste ships, so there is no generated type to decode
//! them into. Their layout was worked out from the wire format on real replays instead
//! (see the notes on each message in `lib.rs`), and this is the reader that goes with
//! that: walk the fields, pick out the numbers that are known, ignore the rest.
//!
//! Anything malformed ends the walk quietly rather than failing it. A message that
//! cannot be read to the end has still yielded whatever came before the damage, and an
//! event with a missing field is dropped by its caller, which is the right outcome for
//! one bad message in a replay of hundreds of thousands.

/// One field's value, by wire type. Only the payload is kept: what the number means is
/// the caller's business.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Value<'a> {
    Varint(u64),
    Fixed64(u64),
    Bytes(&'a [u8]),
    Fixed32(u32),
}

/// The fields of one message, in wire order. A repeated field comes out once per
/// occurrence.
pub struct Fields<'a> {
    buf: &'a [u8],
    pos: usize,
}

pub fn fields(buf: &[u8]) -> Fields<'_> {
    Fields { buf, pos: 0 }
}

impl<'a> Fields<'a> {
    fn varint(&mut self) -> Option<u64> {
        let mut value = 0u64;
        let mut shift = 0;
        loop {
            let byte = *self.buf.get(self.pos)?;
            self.pos += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
            shift += 7;
            if shift > 63 {
                return None;
            }
        }
    }

    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let out = self.buf.get(self.pos..end)?;
        self.pos = end;
        Some(out)
    }
}

impl<'a> Iterator for Fields<'a> {
    type Item = (u32, Value<'a>);

    fn next(&mut self) -> Option<Self::Item> {
        if self.pos >= self.buf.len() {
            return None;
        }
        let key = self.varint()?;
        let field = u32::try_from(key >> 3).ok().filter(|&f| f != 0)?;
        let value = match key & 7 {
            0 => Value::Varint(self.varint()?),
            1 => Value::Fixed64(u64::from_le_bytes(self.take(8)?.try_into().ok()?)),
            2 => {
                let len = usize::try_from(self.varint()?).ok()?;
                Value::Bytes(self.take(len)?)
            }
            5 => Value::Fixed32(u32::from_le_bytes(self.take(4)?.try_into().ok()?)),
            // Groups (3, 4) are long deprecated and nothing here sends them.
            _ => return None,
        };
        Some((field, value))
    }
}

/// Every varint under `field`, in order: all of them for a repeated field.
pub fn varints(buf: &[u8], field: u32) -> impl Iterator<Item = u64> + '_ {
    fields(buf).filter_map(move |(f, v)| match v {
        Value::Varint(n) if f == field => Some(n),
        _ => None,
    })
}

/// The first varint under `field`.
pub fn varint(buf: &[u8], field: u32) -> Option<u64> {
    varints(buf, field).next()
}

/// The first length-delimited payload under `field`: a string, bytes or a sub-message.
pub fn bytes(buf: &[u8], field: u32) -> Option<&[u8]> {
    fields(buf).find_map(|(f, v)| match v {
        Value::Bytes(b) if f == field => Some(b),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A hero kill as it came off replay 106580413 at tick 42551: victim 79, source 89,
    /// inflictor 89, one assister (86), credited killer 89, team 3.
    const KILL: [u8; 14] = [8, 79, 16, 89, 24, 89, 32, 86, 40, 89, 48, 0, 56, 3];

    #[test]
    fn reads_varints_by_field() {
        assert_eq!(varint(&KILL, 1), Some(79));
        assert_eq!(varint(&KILL, 5), Some(89));
        assert_eq!(varint(&KILL, 9), None);
    }

    #[test]
    fn repeats_a_repeated_field() {
        let two_assists = [8, 1, 32, 5, 32, 6, 40, 2];
        assert_eq!(varints(&two_assists, 4).collect::<Vec<_>>(), vec![5, 6]);
    }

    #[test]
    fn reads_strings_and_multibyte_varints() {
        // An ability cast: caster ehandle 1851479 twice, then its name.
        let mut cast = vec![8, 0xd7, 0x80, 0x71, 16, 0xd7, 0x80, 0x71, 26, 13];
        cast.extend_from_slice(b"synth_barrage");
        assert_eq!(varint(&cast, 1), Some(1851479));
        assert_eq!(bytes(&cast, 3), Some(&b"synth_barrage"[..]));
    }

    #[test]
    fn stops_quietly_on_a_truncated_message() {
        // Field 3 claims 13 bytes and has 2.
        let cut = [8, 7, 26, 13, b'a', b'b'];
        assert_eq!(fields(&cut).count(), 1);
        assert_eq!(bytes(&cut, 3), None);
    }

    #[test]
    fn skips_fixed_width_fields() {
        // A float (fixed32) between two varints must not derail the walk.
        let msg = [8, 1, 0x35, 0, 0, 0x80, 0x3f, 16, 2];
        assert_eq!(varint(&msg, 2), Some(2));
    }
}
