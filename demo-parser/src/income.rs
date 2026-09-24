//! Where each player's souls came from, second by second.
//!
//! # What the replay has
//!
//! The game keeps a per-source income history, but sends it to each player's own client
//! only: no replay measured carried a single one of those messages (`GoldHistory`,
//! `CurrencyChanged`), and the parser does see every message a replay has. What a
//! replay does have is:
//!
//!  - Each player's net worth, at full tick rate. Its rises are the income, exactly --
//!    but unlabelled. On a real match they were a trickle of +1..+3 about once a second,
//!    +32/+33 shares as lane troopers died near the hero (no last hit needed), larger
//!    steps for kills, objectives and the like, and a drop on each death.
//!  - The post-match summary, if the recording ran to the end: per player, the souls
//!    from each source (the game's own split) every 3 minutes up to 15:00, every 5 after,
//!    and at the end, stamped on the game clock.
//!
//! # How the split is made
//!
//! Each rise in net worth is shared among the sources with evidence near it -- a kill or
//! assist credited to the player, a lane trooper dying near them, their damage to a
//! neutral creep, their last hit or deny, a boss falling to their team, a crate or statue
//! breaking beside them -- within [`BEFORE_SECONDS`] before to [`AFTER_SECONDS`] after.
//! A source the summary says paid out in an interval, but with no evidence anywhere in
//! it, may take any rise. Then the shares are scaled, alternately per source and per
//! rise (iterative proportional fitting), until every source's total over the interval
//! matches the summary. So at each snapshot the split is the game's own, and between
//! them it follows the events.
//!
//! # How good it is
//!
//! Measured on three matches by hiding each interior snapshot, fitting the merged
//! interval around it, and comparing with the hidden one: 11-12% of the income up to it
//! landed in the wrong source, against 18% for the best the summary alone can do (each
//! interval's mix held constant). Kills, assists, lane, objectives and breakables were
//! well placed; neutral camps were not, because only about 40% of neutral creeps' deaths
//! are in a replay at all (a creep nobody is near is not sent). Item and ability income
//! (Trophy Collector, Cultist Sacrifice, Golden Goose Egg, Assassinate), the Urn and the
//! team bonus have nothing to place them by and are spread over their interval.
//!
//! The team bonus is kept apart from objectives. It is large -- up to 6.8k souls a player
//! on one match -- but it is not paid for objectives: it starts before any has fallen, one
//! player got none all match while doing the most objective damage, and the summary gives
//! it no kill count or damage. What the game pays it for, it does not say. Boss souls, by
//! contrast, follow the objective damage the summary lists beside them.
//!
//! Without a summary nothing is calibrated: each rise is split evenly among the evidence
//! near it, or counted as other.

use crate::wire;
use serde::Serialize;
use std::collections::BTreeMap;

/// Sources as the post-match summary numbers them (`EGoldSource`).
pub const KILLS: usize = 1;
pub const LANE: usize = 2;
pub const NEUTRALS: usize = 3;
pub const BOSSES: usize = 4;
pub const ASSISTS: usize = 6;
pub const DENIES: usize = 7;
pub const BREAKABLES: usize = 12;
/// The team bonus: see the module note.
const TEAM_BONUS: usize = 8;
/// One past the highest source number seen.
const RAW: usize = 14;
/// Sources that come from an event the replay can show.
const EVENT_SOURCES: [usize; 7] = [KILLS, LANE, NEUTRALS, BOSSES, ASSISTS, DENIES, BREAKABLES];

/// What the viewer shows: the game's sources, grouped.
const BUCKETS: [&str; 8] = [
    "kills",
    "assists",
    "lane",
    "neutrals",
    "objectives",
    "breakables",
    "teamBonus",
    "other",
];
const OTHER: usize = 7;

fn bucket(source: usize) -> usize {
    match source {
        KILLS => 0,
        ASSISTS => 1,
        LANE | DENIES => 2,
        NEUTRALS => 3,
        BOSSES => 4,
        BREAKABLES => 5,
        TEAM_BONUS => 6,
        _ => OTHER,
    }
}

/// How long before a rise its evidence may come: lane souls arrive as orbs, a moment
/// after the trooper that dropped them.
const BEFORE_SECONDS: f32 = 4.0;
const AFTER_SECONDS: f32 = 0.5;
/// How near a trooper's death a hero shares its souls, in world units.
pub const SHARE_RANGE: f32 = 1800.0;
/// How near a break a hero is taken to have made it.
pub const BREAK_RANGE: f32 = 1000.0;
/// Scaling rounds. Measured, the fit is settled well before this.
const ROUNDS: usize = 60;

#[derive(Default)]
pub struct Collect {
    /// Per player: `(tick, net worth)` at each change.
    net_worth: Vec<Vec<(i32, i32)>>,
    /// Per player, per source: ticks of evidence, in order.
    evidence: Vec<[Vec<i32>; RAW]>,
    /// The post-match summary, if the recording has one.
    pub summary: Option<Vec<u8>>,
}

impl Collect {
    fn player(&mut self, player: i32) -> Option<usize> {
        let p = usize::try_from(player).ok()?;
        if self.net_worth.len() <= p {
            self.net_worth.resize(p + 1, Vec::new());
            self.evidence.resize_with(p + 1, Default::default);
        }
        Some(p)
    }

    pub fn net_worth(&mut self, player: i32, tick: i32, value: i32) {
        let Some(p) = self.player(player) else { return };
        let list = &mut self.net_worth[p];
        if list.last().map_or(value != 0, |&(_, last)| last != value) {
            list.push((tick, value));
        }
    }

    pub fn evidence(&mut self, player: i32, source: usize, tick: i32) {
        let Some(p) = self.player(player) else { return };
        let list = &mut self.evidence[p][source];
        if list.last() != Some(&tick) {
            list.push(tick);
        }
    }

    /// Evidence for every hero within `range` of `at`; `heroes` is each player's position,
    /// if alive.
    pub fn near(&mut self, heroes: &[Option<[f32; 2]>], at: [f32; 2], range: f32, source: usize, tick: i32) {
        for (player, hero) in heroes.iter().enumerate() {
            if let Some(h) = hero {
                if (h[0] - at[0]).hypot(h[1] - at[1]) < range {
                    self.evidence(player as i32, source, tick);
                }
            }
        }
    }

    fn has(&self, player: usize, source: usize, tick: i32, before: i32, after: i32) -> bool {
        let list = &self.evidence[player][source];
        let i = list.partition_point(|&t| t < tick - before);
        list.get(i).is_some_and(|&t| t <= tick + after)
    }
}

#[derive(Serialize)]
pub struct Income {
    /// Whether the split was fitted to the post-match summary. See the module note.
    calibrated: bool,
    /// What each index of `souls` holds.
    sources: Vec<&'static str>,
    /// Seconds into the recording of each summary snapshot: where the split is exact.
    checkpoints: Vec<f32>,
    /// Per player, per source: souls earned so far, one value per frame.
    souls: Vec<Vec<Vec<i32>>>,
}

/// One player's summary snapshots: tick, and souls per source so far.
type Snapshots = Vec<(i32, [f64; RAW])>;

fn read_summary(summary: &[u8], tick_of_game: &dyn Fn(f32) -> Option<i32>) -> BTreeMap<u32, Snapshots> {
    let bytes = |buf: &[u8], field: u32| -> Vec<Vec<u8>> {
        wire::fields(buf)
            .filter_map(|(n, v)| match v {
                wire::Value::Bytes(b) if n == field => Some(b.to_vec()),
                _ => None,
            })
            .collect()
    };
    let info = wire::bytes(summary, 2).unwrap_or(summary);
    let mut out = BTreeMap::new();
    for player in bytes(info, 4) {
        let Some(slot) = wire::varint(&player, 2) else { continue };
        let mut snaps = Snapshots::new();
        for stats in bytes(&player, 5) {
            let seconds = wire::varint(&stats, 1).unwrap_or(0) as f32;
            let Some(tick) = tick_of_game(seconds) else { continue };
            let mut souls = [0.0; RAW];
            for source in bytes(&stats, 40) {
                let k = wire::varint(&source, 1).unwrap_or(1) as usize;
                if k < RAW {
                    souls[k] += (wire::varint(&source, 4).unwrap_or(0) + wire::varint(&source, 5).unwrap_or(0)) as f64;
                }
            }
            snaps.push((tick, souls));
        }
        out.insert(slot as u32, snaps);
    }
    out
}

/// Shares `rises` among sources so each source's total meets `target`. Returns, per rise,
/// souls per source.
fn fit(rises: &[(i32, f64)], allowed: &dyn Fn(i32, usize) -> bool, target: &[f64; RAW]) -> Vec<[f64; RAW]> {
    let paying: Vec<usize> = (0..RAW).filter(|&k| target[k] > 0.0).collect();
    let evidenced: Vec<usize> = paying.iter().copied().filter(|&k| rises.iter().any(|r| allowed(r.0, k))).collect();
    let mut shares: Vec<[f64; RAW]> = rises
        .iter()
        .map(|&(t, amount)| {
            let mut row = [0.0; RAW];
            let mut take: Vec<usize> = paying.iter().copied().filter(|&k| !evidenced.contains(&k) || allowed(t, k)).collect();
            if take.is_empty() {
                take = paying.clone();
            }
            for &k in &take {
                row[k] = amount / take.len() as f64;
            }
            row
        })
        .collect();
    for _ in 0..ROUNDS {
        for &k in &paying {
            let total: f64 = shares.iter().map(|r| r[k]).sum();
            if total > 0.0 {
                let f = target[k] / total;
                shares.iter_mut().for_each(|r| r[k] *= f);
            }
        }
        for (row, &(_, amount)) in shares.iter_mut().zip(rises) {
            let total: f64 = row.iter().sum();
            if total > 0.0 {
                let f = amount / total;
                row.iter_mut().for_each(|v| *v *= f);
            }
        }
    }
    shares
}

/// Everything the fit needs from the rest of the parse.
pub struct Context<'a> {
    /// Each player's summary slot, in output order.
    pub slots: &'a [u32],
    pub frames: usize,
    /// The frame a tick's rise first shows in.
    pub frame_of: &'a dyn Fn(i32) -> usize,
    /// Seconds into the recording, for a tick.
    pub seconds_of: &'a dyn Fn(i32) -> f32,
    pub tick_of_game: &'a dyn Fn(f32) -> Option<i32>,
    pub game_start: Option<i32>,
    pub ticks_per_second: f32,
}

pub fn build(c: &Collect, cx: &Context) -> Income {
    let snapshots = c.summary.as_deref().map(|s| read_summary(s, cx.tick_of_game)).unwrap_or_default();
    let before = (BEFORE_SECONDS * cx.ticks_per_second) as i32;
    let after = (AFTER_SECONDS * cx.ticks_per_second) as i32;
    let mut calibrated = !cx.slots.is_empty();
    let mut checkpoints = vec![];
    let mut souls = vec![];
    for (p, slot) in cx.slots.iter().enumerate() {
        let mut add = vec![vec![0.0f64; cx.frames]; BUCKETS.len()];
        let mut put = |tick: i32, bucket: usize, amount: f64| {
            let f = (cx.frame_of)(tick).min(cx.frames.saturating_sub(1));
            if let Some(v) = add[bucket].get_mut(f) {
                *v += amount;
            }
        };
        let empty = vec![];
        let worth = c.net_worth.get(p).unwrap_or(&empty);
        let mut rises = vec![];
        let mut last = 0;
        for &(t, v) in worth {
            if v > last {
                rises.push((t, (v - last) as f64));
            }
            last = v;
        }
        let allowed = |t: i32, k: usize| p < c.evidence.len() && c.has(p, k, t, before, after);
        // Split evenly among the evidence, for rises no snapshot covers.
        let uncalibrated = |rise: &(i32, f64), put: &mut dyn FnMut(i32, usize, f64)| {
            let near: Vec<usize> = EVENT_SOURCES.iter().copied().filter(|&k| allowed(rise.0, k)).collect();
            if near.is_empty() {
                put(rise.0, OTHER, rise.1);
            }
            for k in &near {
                put(rise.0, bucket(*k), rise.1 / near.len() as f64);
            }
        };
        let snaps = snapshots.get(slot);
        if snaps.map_or(true, |s| s.is_empty()) {
            calibrated = false;
        }
        let snaps: &[(i32, [f64; RAW])] = snaps.map_or(&[], |s| s.as_slice());
        if checkpoints.is_empty() {
            checkpoints = snaps.iter().map(|s| (cx.seconds_of)(s.0)).collect();
        }
        // Rises before the match starts are the starting souls.
        let start = cx.game_start.unwrap_or(i32::MIN);
        let mut so_far = [0.0; RAW];
        let mut i = 0;
        while i < rises.len() && rises[i].0 <= start {
            put(rises[i].0, OTHER, rises[i].1);
            i += 1;
        }
        for &(until, cumulative) in snaps {
            let j = i + rises[i..].partition_point(|r| r.0 <= until);
            let part = &rises[i..j];
            let mut target = [0.0; RAW];
            for k in 0..RAW {
                target[k] = (cumulative[k] - so_far[k]).max(0.0);
            }
            let wanted: f64 = target.iter().sum();
            let got: f64 = part.iter().map(|r| r.1).sum();
            if wanted > 0.0 && got > 0.0 {
                // The summary and the live net worth disagree by a percent or two; the
                // live rises are what the viewer shows, so the summary's mix is kept and
                // its total is not.
                target.iter_mut().for_each(|v| *v *= got / wanted);
                for (rise, row) in part.iter().zip(fit(part, &allowed, &target)) {
                    for (k, v) in row.iter().enumerate() {
                        if *v > 0.0 {
                            put(rise.0, bucket(k), *v);
                        }
                    }
                }
            } else {
                part.iter().for_each(|r| uncalibrated(r, &mut put));
            }
            so_far = cumulative;
            i = j;
        }
        rises[i..].iter().for_each(|r| uncalibrated(r, &mut put));

        souls.push(
            add.into_iter()
                .map(|column| {
                    let mut total = 0.0;
                    column
                        .into_iter()
                        .map(|v| {
                            total += v;
                            total.round() as i32
                        })
                        .collect()
                })
                .collect(),
        );
    }
    Income {
        calibrated,
        sources: BUCKETS.to_vec(),
        checkpoints,
        souls,
    }
}
