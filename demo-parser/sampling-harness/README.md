# sampling-harness

Measures what a replay's position stream costs, and what it loses, at each sample rate.

This is the tool `POSITION_HZ` and `POSITION_QUANT` in `../src/lib.rs` were chosen with.
It is kept so those constants can be re-argued against evidence rather than memory — when
the map changes, when heroes get faster, or when a second stream (troopers, projectiles)
is being considered.

```console
$ cargo run --release -- "D:/SteamLibrary/steamapps/common/Deadlock/game/citadel/replays/<id>.dem"
```

Needs `protoc` on `PATH` (or `$PROTOC` pointing at it): haste generates its protobuf code
at build time.

## What it reports

A **rate sweep** at whole-unit precision, so rate is the only thing varying, and a
**quantisation sweep** at the two rates worth choosing between. Sizes are after delta +
zigzag varint encoding — what protobuf packed `sint32` produces — then gzip and brotli.

Error is the number that decides the rate. It is measured by linearly interpolating the
decimated series back to full rate and comparing against what actually happened, because
that is exactly what a viewer draws between stored samples. Size only decides whether the
choice is affordable.

It also writes `sampling-report.html`, self-contained, showing one player's path at each
rate. The numbers say how much error there is; the picture says what kind — corner-cutting
looks nothing like a straight line drawn across the map through a wall.

## What it found

On a 35-minute match, 12 players, 134144 ticks at 64 Hz:

| rate | brotli | mean err | p99 | max |
| ---- | ------ | -------- | --- | --- |
| 64 Hz | 570K | 0 | 0 | 0 |
| 16 Hz | 393K | 1 | 4 | 14432 |
| 8 Hz | 308K | 2 | 11 | 14149 |
| 4 Hz | 210K | 7 | 30 | 14599 |
| 2 Hz | 126K | 18 | 80 | 12765 |
| 1 Hz | 73K | 47 | 204 | 13896 |

Two things came out of this, and both are now in the parser:

**Quantisation is a bigger lever than rate.** At 8 Hz, rounding to 16 units cut the
stream from 308K to 125K — two and a half times — for a loss below one minimap pixel. The
map is about 18000 by 21000 units and a minimap is roughly a thousand pixels across, so
some twenty units land on a pixel; anything finer is paid for and never seen.

**Max error does not fall with the rate.** It is about 14000 units at 16 Hz and at 4 Hz
alike, because it is not a sampling artefact: players zip-line, teleport and respawn, and
interpolating across one of those draws a line through terrain nobody walked. That is why
the parser raises a `cut` flag instead of sampling faster — and why it raises it from the
full 64 Hz stream, since the jump usually happens between two kept frames.

The jump counts in the HTML report are comparable only within a panel: the threshold is
per drawn step, which spans a different amount of time at each rate.
