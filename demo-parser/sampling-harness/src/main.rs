//! Measures what a replay's position stream costs, and what it loses, at each sample rate.
//!
//! This is the tool the parser's `POSITION_HZ` and `POSITION_QUANT` were chosen with.
//! It exists so those constants can be re-argued against evidence rather than memory --
//! when the map changes, when heroes get faster, or when a second stream (troopers,
//! projectiles) is being considered.
//!
//! It records every player pawn at the demo's full tick rate, then for each candidate
//! rate reports:
//!
//!  - **size**, after quantising, delta + zigzag varint encoding (what protobuf packed
//!    `sint32` produces) and compressing;
//!  - **reconstruction error**, by linearly interpolating the decimated series back to
//!    full rate and comparing against what actually happened. A viewer interpolates
//!    between stored samples, so this is exactly the error a watcher sees. It is the
//!    number that decides the rate; size only decides whether the choice is affordable.
//!
//! It also counts discontinuities -- zip lines, teleports, respawns. Those produce error
//! that no sample rate reduces, which is why the parser marks them instead.
//!
//! ```console
//! $ cargo run --release -- <path-to-demo>
//! ```
//!
//! Needs `protoc` on `PATH` (or `$PROTOC`), because haste generates its protobuf code at
//! build time.

use haste::demofile::DemoFile;
use haste::entities::{deadlock_coord_from_cell, fkey_from_path, DeltaHeader, Entity};
use haste::parser::{Context, Parser, Visitor};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufReader, Write};
use std::rc::Rc;

const PAWN: u64 = haste::fxhash::hash_bytes(b"CCitadelPlayerPawn");

const CELL_X: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_cellX"]);
const CELL_Y: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_cellY"]);
const CELL_Z: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_cellZ"]);
const VEC_X: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_vecX"]);
const VEC_Y: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_vecY"]);
const VEC_Z: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_vecZ"]);

/// Sample rates to compare, in Hz. Anything above the demo's own rate collapses onto it.
const RATES: &[f32] = &[64.0, 16.0, 8.0, 4.0, 2.0, 1.0];

/// Quantisation steps to compare, in world units.
const QUANTS: &[i32] = &[1, 4, 16, 64];

/// Rates the quantisation sweep is run at: the two worth choosing between.
const SWEEP_RATES: &[f32] = &[8.0, 4.0];

/// Above this, in units per second, a step is a teleport rather than running. Deadlock
/// characters move on the order of 400 to 700 u/s on foot.
const TELEPORT_SPEED: f32 = 2000.0;

const FALLBACK_TICK_INTERVAL: f32 = 1.0 / 64.0;

/// One axis of a position, from the cell it sits in and the offset within that cell.
fn coord(e: &Entity, cell: u64, vec: u64) -> Option<f32> {
    let cell: u16 = e.get_value(&cell)?;
    let offset: f32 = e.get_value(&vec)?;
    Some(deadlock_coord_from_cell(cell, offset))
}

#[derive(Default)]
struct State {
    /// Pawn entity index -> one position per tick, parallel to `ticks`.
    tracks: BTreeMap<i32, Vec<[f32; 3]>>,
    /// Last known position per pawn. Entities send deltas, so a standing player sends
    /// nothing and the previous value is the right one to record.
    last: BTreeMap<i32, [f32; 3]>,
    ticks: usize,
    tick_interval: f32,
}

#[derive(Default, Clone)]
struct Collector(Rc<RefCell<State>>);

impl Visitor for Collector {
    fn on_entity(&mut self, _ctx: &Context, _d: DeltaHeader, e: &Entity) -> anyhow::Result<()> {
        if !e.serializer_name_heq(PAWN) {
            return Ok(());
        }
        if let (Some(x), Some(y), Some(z)) = (
            coord(e, CELL_X, VEC_X),
            coord(e, CELL_Y, VEC_Y),
            coord(e, CELL_Z, VEC_Z),
        ) {
            self.0.borrow_mut().last.insert(e.index(), [x, y, z]);
        }
        Ok(())
    }

    fn on_tick_end(&mut self, ctx: &Context) -> anyhow::Result<()> {
        let mut st = self.0.borrow_mut();
        st.tick_interval = ctx.tick_interval();
        let ticks = st.ticks;
        let seen: Vec<(i32, [f32; 3])> = st.last.iter().map(|(&i, &p)| (i, p)).collect();
        for (index, pos) in seen {
            let track = st.tracks.entry(index).or_default();
            // A pawn first seen mid-match starts where it appeared, rather than at origin.
            track.resize(ticks, pos);
            track.push(pos);
        }
        st.ticks += 1;
        Ok(())
    }
}

/// Zigzag varint, as protobuf encodes packed `sint32`.
fn varint(out: &mut Vec<u8>, value: i32) {
    let mut v = ((value << 1) ^ (value >> 31)) as u32;
    while v > 127 {
        out.push((v & 127) as u8 | 128);
        v >>= 7;
    }
    out.push(v as u8);
}

/// Delta + varint encoding of every track, decimated to `step` and quantised to `quant`.
fn encode(tracks: &[Vec<[f32; 3]>], step: usize, quant: f32, axes: usize) -> Vec<u8> {
    let mut out = Vec::new();
    for track in tracks {
        for axis in 0..axes {
            let mut prev = 0i32;
            for sample in track.iter().step_by(step) {
                let q = (sample[axis] / quant).round() as i32;
                varint(&mut out, q - prev);
                prev = q;
            }
        }
    }
    out
}

fn gzip(data: &[u8]) -> usize {
    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    e.write_all(data).unwrap();
    e.finish().unwrap().len()
}

fn brotli_len(data: &[u8]) -> usize {
    let mut out = Vec::new();
    let mut w = brotli::CompressorWriter::new(&mut out, 4096, 11, 22);
    w.write_all(data).unwrap();
    drop(w);
    out.len()
}

fn dist(a: [f32; 3], b: [f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// Error a viewer would see at `step`, as (mean, p99, max) in world units.
fn error(track: &[[f32; 3]], step: usize) -> Vec<f32> {
    if step <= 1 {
        return Vec::new();
    }
    let samples: Vec<[f32; 3]> = track.iter().copied().step_by(step).collect();
    (0..track.len())
        .map(|tick| {
            let i = tick / step;
            let frac = (tick % step) as f32 / step as f32;
            let a = samples[i.min(samples.len() - 1)];
            let b = samples[(i + 1).min(samples.len() - 1)];
            let lerp = [
                a[0] + (b[0] - a[0]) * frac,
                a[1] + (b[1] - a[1]) * frac,
                a[2] + (b[2] - a[2]) * frac,
            ];
            dist(lerp, track[tick])
        })
        .collect()
}

fn main() -> anyhow::Result<()> {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: sampling-harness <path-to-demo>");
        return Ok(());
    };

    let started = std::time::Instant::now();
    let demo = DemoFile::start_reading(BufReader::new(File::open(&path)?))?;
    let collector = Collector::default();
    let state = collector.0.clone();
    let mut parser = Parser::from_stream_with_visitor(demo, collector)?;
    parser.run_to_end()?;
    let st = std::mem::take(&mut *state.borrow_mut());

    let interval = if st.tick_interval > 0.0 {
        st.tick_interval
    } else {
        FALLBACK_TICK_INTERVAL
    };
    let full_rate = 1.0 / interval;
    println!(
        "parsed in {:?} -- {} ticks at {:.1} Hz",
        started.elapsed(),
        st.ticks,
        full_rate
    );

    // Only pawns present for most of the match are players: the observer and transient
    // pawns would skew both size and error.
    let tracks: Vec<Vec<[f32; 3]>> = st
        .tracks
        .into_values()
        .filter(|t| t.len() > st.ticks / 2)
        .collect();
    println!("{} players tracked", tracks.len());

    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for track in &tracks {
        for p in track {
            for i in 0..3 {
                lo[i] = lo[i].min(p[i]);
                hi[i] = hi[i].max(p[i]);
            }
        }
    }
    println!(
        "map extent  x {:.0}..{:.0}  y {:.0}..{:.0}  z {:.0}..{:.0}",
        lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]
    );

    let mut jumps = 0usize;
    let mut fastest: f32 = 0.0;
    for track in &tracks {
        for w in track.windows(2) {
            let speed = dist(w[0], w[1]) / interval;
            if speed > TELEPORT_SPEED {
                jumps += 1;
                fastest = fastest.max(speed);
            }
        }
    }
    println!("discontinuities over {TELEPORT_SPEED:.0} u/s: {jumps} (fastest {fastest:.0} u/s)");

    // Rate sweep at whole-unit precision, so rate is the only thing varying.
    println!("\nrate sweep (quant 1, xyz)");
    println!(
        "{:>7} {:>8} {:>8} {:>8} {:>8} {:>7} {:>7} {:>8}",
        "rate", "frames", "raw", "gzip", "brotli", "mean", "p99", "max"
    );
    println!("{}", "-".repeat(66));
    for &rate in RATES {
        let step = ((full_rate / rate).round() as usize).max(1);
        let encoded = encode(&tracks, step, 1.0, 3);
        let mut errors: Vec<f32> = tracks.iter().flat_map(|t| error(t, step)).collect();
        errors.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let mean = if errors.is_empty() {
            0.0
        } else {
            errors.iter().sum::<f32>() / errors.len() as f32
        };
        let p99 = errors
            .get((errors.len() as f32 * 0.99) as usize)
            .copied()
            .unwrap_or(0.0);
        println!(
            "{:>6.0}Hz {:>8} {:>7.0}K {:>7.0}K {:>7.0}K {:>7.0} {:>7.0} {:>8.0}",
            rate,
            tracks[0].len().div_ceil(step),
            encoded.len() as f32 / 1024.0,
            gzip(&encoded) as f32 / 1024.0,
            brotli_len(&encoded) as f32 / 1024.0,
            mean,
            p99,
            errors.last().copied().unwrap_or(0.0)
        );
    }
    println!("sizes cover all {} players for the whole match; errors in world units", tracks.len());

    // Quantisation sweep. Roughly twenty units land on one minimap pixel, so precision
    // finer than that is paid for and never seen -- which this is here to quantify.
    println!("\nquantisation sweep");
    println!("{:>7} {:>7} {:>5} {:>8} {:>8} {:>8}", "rate", "quant", "axes", "raw", "gzip", "brotli");
    println!("{}", "-".repeat(48));
    for &rate in SWEEP_RATES {
        let step = ((full_rate / rate).round() as usize).max(1);
        for &quant in QUANTS {
            for &axes in &[3usize, 2] {
                let encoded = encode(&tracks, step, quant as f32, axes);
                println!(
                    "{:>6.0}Hz {:>7} {:>5} {:>7.0}K {:>7.0}K {:>7.0}K",
                    rate,
                    quant,
                    if axes == 3 { "xyz" } else { "xy" },
                    encoded.len() as f32 / 1024.0,
                    gzip(&encoded) as f32 / 1024.0,
                    brotli_len(&encoded) as f32 / 1024.0
                );
            }
        }
    }

    write_report(&tracks[0], full_rate)?;
    Ok(())
}

/// Writes a self-contained page comparing one player's path at each rate.
///
/// The numbers say how much error there is; this says what kind. Corner-cutting looks
/// different from a straight line drawn across the map through a wall, and only one of
/// those is fixed by sampling faster.
///
/// Data is inlined so the file opens from disk with no server.
fn write_report(track: &[[f32; 3]], full_rate: f32) -> anyhow::Result<()> {
    let points: Vec<[i32; 2]> = track
        .iter()
        .map(|p| [p[0].round() as i32, p[1].round() as i32])
        .collect();
    let html = include_str!("report.html").replace("__TRUTH__", &serde_json::to_string(&points)?);
    let html = html.replace("__FULL_RATE__", &format!("{full_rate:.0}"));
    std::fs::write("sampling-report.html", html)?;
    println!("\nwrote sampling-report.html -- open it to see where interpolation breaks");
    Ok(())
}
