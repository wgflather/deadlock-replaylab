//! Turns a Deadlock `.dem` replay into a scoreboard timeline, in the browser.
//!
//! The demo is never held in wasm memory. A replay is roughly half a gigabyte, and
//! handing one to wasm as a byte slice costs that much again on top of the copy the page
//! already holds. Instead the parser pulls the file through a JS callback a window at a
//! time (see [`JsStream`]), which keeps the whole parse inside a few tens of megabytes.
//!
//! # Shape of the output
//!
//! The parser sees every tick regardless; sampling only decides how much of that it
//! keeps. What limits the sample rate is the size of the result, so the result is built
//! to be small: identity (name, Steam id, hero) is stated once per player, and each
//! statistic is one flat array of numbers per player over time. A frame is then an index
//! into those arrays rather than an object, which is what makes a one-second sample rate
//! affordable -- as a list of per-frame objects the same timeline costs roughly fifteen
//! times more.
//!
//! There are two streams, sampled at different rates because they change at different
//! rates. Counters move slowly and are kept once a second. Positions are the only
//! continuous quantity and are kept eight times a second, which measurement put at
//! roughly eleven units of error at the 99th percentile -- well under a minimap pixel.
//!
//! # Positions
//!
//! Quantised to [`POSITION_QUANT`] units before storage. The map is some 18000 by 21000
//! units and a minimap is about a thousand pixels across, so around twenty units land on
//! one pixel: finer precision is paid for and never seen. Measured, the quantisation is
//! worth more than the sample rate -- it cut the encoded stream by two and a half times
//! for a loss below one pixel.
//!
//! Each frame also carries a "cut" flag. Players zip-line, teleport and respawn, and a
//! viewer interpolating across one of those draws a straight line through terrain that
//! nobody walked. Measurement showed this error does not shrink with the sample rate at
//! all -- it was about 14000 units at 16 Hz and at 4 Hz alike -- so it is marked rather
//! than sampled away. The flag is raised from the full 64 Hz stream, not from the
//! sampled one, because the jump usually happens between two kept frames.
//!
//! # Creeps
//!
//! Lane troopers, the ones that march in waves and are the obvious sense of "creep",
//! are tracked as a couple of thousand short lives rather than twelve fixed tracks the
//! way players are -- each alive for well under a minute on average, so a dense
//! per-frame array padded to the whole match would be almost entirely padding. Each one
//! is instead one record -- team, when it started, and its own x/y for exactly as long
//! as it existed -- which costs roughly what its actual lifetime is worth and nothing
//! for the rest of the match. See [`Creep`].
//!
//! Creeps are sampled on their own, slower clock ([`CREEP_HZ`]): nobody follows a single
//! trooper across the map the way they might a player, so the finer position rate buys
//! nothing here, and there are a couple of orders of magnitude more of these than there
//! are players.
//!
//! # Objectives
//!
//! The first kind is the lane Guardian ([`GUARDIAN`]). It was mistaken for a second kind
//! of creep wave at first, on the strength of sitting in a narrow band on a lane and
//! nowhere else -- reasonable for a trooper, and also exactly what a tower defending
//! that lane would do. A trooper wave marches; this does not, ever, which is what a
//! second look at the same measurement should have said sooner: three fixed points per
//! team, there from very early in the match, none of them moving a unit the whole game.
//!
//! Unlike a creep, there is a small fixed number of these and each has one life for the
//! whole match, so they are tracked as dense arrays the same way players are rather than
//! as sparse lives: position is a single fixed point, and health is sampled on the
//! scoreboard's own clock ([`SAMPLE_SECONDS`]) rather than a separate one, since nothing
//! about a structure's health changes fast enough to need a player's finer rate, let
//! alone a creep's. A destroyed Guardian gets a real `DeltaHeader::DELETE` -- confirmed
//! on a real match, all six went this way.
//!
//! The second kind is the Walker ([`WALKER`]), the tier-two structure behind each lane's
//! Guardian: six per match, at the same six points on every match measured, and just as
//! stationary. Two things about it the Guardian did not show:
//!
//!  - Its maximum health grows mid-match. All six start at 6000, and each time one falls
//!    the surviving Walkers on the same team gain 3000 to both current and maximum --
//!    measured on three matches, a last Walker standing ends at 12000. Nothing special
//!    is needed for this: `maxHp` is already sampled per frame rather than stated once.
//!  - Health is not a reliable death signal. A Walker reaches zero, `m_lifeState` goes
//!    to 1, and then health ticks back up a few points (0, 1, 4, 5 on one match) through
//!    the seven-odd seconds before its `DELETE`. Read as "last known health", that
//!    Walker would have sat on the map at 5 of 12000 for the rest of the match. So death
//!    is latched instead, on `m_lifeState` or `DELETE`, whichever comes first, and a
//!    destroyed objective's health is pinned at zero from then on -- for Guardians too,
//!    which gain nothing from being trusted not to do the same.
//!
//! The rest, measured on the same three matches:
//!
//!  - Base Guardians ([`BASE_GUARDIAN`]), six per team in pairs around the base. Behave
//!    like a Walker: `m_lifeState` on death, `DELETE` a few seconds later.
//!  - Shrines ([`SHRINE`]), two per team. The one kind whose `m_lifeState` never moves:
//!    health reaches zero and `DELETE` follows about five seconds after, so it is the
//!    `DELETE` that latches it. When one falls, the other's maximum doubles from 5000 to
//!    10000, current health with it.
//!  - The Patron ([`PATRON`]), one per team at the back of its base. Maximum health
//!    climbs by 250 a minute from about twenty minutes in, and when its Shrines are gone
//!    it drops straight to a fresh 12000 of 12000 -- its second phase -- without passing
//!    through zero. Its death is the end of the match, so it never gets a `DELETE`: the
//!    `m_lifeState` latch is the only thing that marks it.
//!  - The Mid-Boss ([`MID_BOSS`]), neutral (team 4), at the centre of the map. The one
//!    objective that comes back: each life is a separate entity, created on a fresh index
//!    minutes after the last one's `DELETE`, with more health each time. Tracked per
//!    index like the rest, that would stack one faded "destroyed" marker per past life
//!    at the same spot, and pad each future life's health with zeros that read as dead
//!    before it had spawned. So its lives share a single track instead ([`MID_BOSS_KEY`]):
//!    a `CREATE` clears the latch, and between lives it reads as down, the same as
//!    before the first spawn.
//!
//! # Lanes
//!
//! A lane's line on the minimap is its zipline, and the part of it drawn for a team is
//! the part that team can ride -- which grows and shrinks as troopers and heroes push.
//! That is not worked out by the client: the rope is a chain of [`ZIPLINE_NODE`]
//! entities, and the server sets each node's `m_iTeamNum` to whoever can use it (0 for
//! nobody). Measured on two matches: 136 nodes, 44 to 46 per lane, created at about 42
//! seconds and never moving; ordered along the rope by `m_iNodeIndex`, from the
//! Sapphire base (node 0) to the Amber base on the outer lanes and the other way round
//! in the middle; and several hundred ownership changes per lane per match, always one
//! contiguous run out from each base with an unowned stretch, if any, between them.
//!
//! Positions are stated once, the way an objective's are. Ownership is a list of
//! changes rather than a per-frame array: a node changes owner a dozen or so times in
//! a match, so a dense array per node would be almost entirely repeats. Changes are on
//! the scoreboard's clock ([`SAMPLE_SECONDS`]), the same one structures use.
//!
//! # Events
//!
//! Everything above is state, sampled on a clock. Some things are not state but moments
//! -- a hero dying, an ability going off -- and those arrive as messages of their own,
//! beside the entity updates rather than inside them. They are kept at full tick
//! precision, one entry per occurrence, rather than sampled: there are only a few
//! thousand of them, and a death rounded to the nearest second would land on the wrong
//! side of the frame that shows it.
//!
//! Neither message is in the protobuf definitions haste ships, so both are read by field
//! number ([`wire`]). The layouts were worked out from the wire format and checked on
//! three matches against the scoreboard's own counters:
//!
//!  - A hero kill ([`MSG_HERO_KILLED`]) names the victim's pawn (1), whatever dealt the
//!    last hit (2) -- which can be a trooper or a Guardian, not only a hero -- every
//!    assister (4, repeated) and the hero credited with the kill (5). Per hero, victims
//!    summed to `m_iDeaths`, field 5 to `m_iPlayerKills` and field 4 to
//!    `m_iPlayerAssists`, exactly, on all three. Field 2 did not match kills: a hero who
//!    finishes someone off with a trooper's help still gets the kill, and the trooper is
//!    what field 2 names. So the killer is field 5, and field 2 is kept only as the
//!    cause.
//!  - An ability cast ([`MSG_ABILITY_CAST`]) carries the caster's handle (1, repeated
//!    verbatim in 2 on every one of some six thousand casts measured) and the ability's
//!    internal name (3), such as `synth_barrage`. Item actives come through the same
//!    message, named `upgrade_*`. A match has a couple of thousand casts and sixty-odd
//!    distinct names, so names are stored once and a cast refers to one by index.
//!
//! Neither message says where it happened. The victim's or caster's own position at
//! that tick is used instead, which is what the position stream would have shown.
//!
//! Two more, much busier -- tens of thousands per match each -- and kept in a reduced
//! form to match:
//!
//!  - A shot ([`MSG_SHOT`]) names its shooter's pawn (5). A viewer only needs to know
//!    *when* someone was firing, not each bullet's path, so consecutive shots are folded
//!    into bursts ([`FIRE_GAP_SECONDS`]). Not every weapon sends this at all: two heroes
//!    of twelve on one match sent some forty each against thousands of weapon hits --
//!    beam and similar weapons, by the look of it. So a weapon hit (a damage message of
//!    kind 1, below) counts as firing too; for everyone else it lands inside a burst
//!    their shots already opened.
//!  - Damage ([`MSG_DAMAGE`]): amount (1), damage kind (4: 1 on 98% of hits whose source
//!    is a weapon), victim (6), attacker (7), inflictor (8) and the ability, item or
//!    weapon it came from (14) -- as the id deadlock-api publishes each one under, so a
//!    viewer can name it from that. A projectile or a summon is the attacker of its own
//!    hits, with the hero who made it as the inflictor: measured, every projectile hit
//!    and all but two of 2617 summon hits resolved that way. Only hits a hero dealt or
//!    took are kept. Summed per hero, hits on enemy heroes came to 101-105% of
//!    `m_iHeroDamage` for all twelve on one match -- close, but not the same number, so
//!    this is a breakdown to read beside the scoreboard's totals, not a replacement for
//!    them. (Crediting only the attacker, without the inflictor, left two heroes 25%
//!    short: their damage was mostly projectiles and summons.)
//!
//! The map's own timers, measured on a real match:
//!
//!  - Neutral camps are not entities; their creeps are ([`TROOPER_NEUTRAL`]). Each
//!    creep's spawn is kept -- when and where -- and its death, when it was seen. Which
//!    camp a creep belongs to is the viewer's to work out, against the camps the game's
//!    own minimap names (web/src/map/camps.ts): nothing in the replay says. A creep far
//!    from every player is simply not sent: dozens were created and never updated again,
//!    idle and out of sight, not dead. So spawn times are certain, but a death is known
//!    only when it was seen (its health reaching zero).
//!  - The Urn ([`URN`]) sits on the map as a pickup until a hero takes it, when it
//!    becomes an ability on that hero ([`URN_CARRIED`]) until delivered -- or dropped on
//!    the carrier's death, which puts a fresh pickup where they fell on the same tick,
//!    before or after the ability goes: both orders were seen. On two matches it spawned
//!    every five minutes from 10:00, alternating sides, and was always delivered to the
//!    side it did not spawn on.
//!  - Crates and Golden Statues ([`BREAKABLE`]) and Sinner's Sacrifices ([`SINNER`]) break with a
//!    debris message ([`MSG_BREAKABLE_DEBRIS`]) naming the entity (its field 1 holds an
//!    entity message whose own field 1 is the handle). A crate never updates after it
//!    spawns -- one health, never deleted -- so the debris is the only sign it broke.
//!    Measured on two matches: every crate break named a crate that was standing, none
//!    broke twice, and every crate slot reused for a respawn had been seen breaking,
//!    the new one on the same spot; crates never seen breaking were still standing at
//!    the end. Who broke a crate is not said and no damage message names one, so it is
//!    credited to the nearest hero within [`CRATE_CREDIT_RANGE`] -- one was within 300
//!    units for 63-82% of breaks, and within 1000 for 93-98%. Statues are credited
//!    the same way. A Sinner's Sacrifice
//!    takes ordinary damage messages, so its breaker is the last hero seen hitting it.
//!    On the match measured all twelve first spawned at 8:00, each coming back five
//!    minutes after it broke.
//!  - Crates and Golden Statues are the same entity class ([`BREAKABLE`]), told apart by
//!    subclass: `m_nSubclassID` is a MurmurHash2 of the subclass's name (seed
//!    0x31415926), and the two hash to `citadel_breakable_prop_wooden_crate` and
//!    `citadel_breakable_item_container` -- the latter the statue. (The same hash names
//!    the neutral troopers' subclasses, `neutral_trooper_weak` and on, which is how the
//!    scheme was checked.) Both share one loop: spawned together at 3:00 on the game
//!    clock, each respawning on its own spot after it breaks.
//!  - The Mid-Boss's death comes as a boss-killed message ([`MSG_BOSS_KILLED`]) of kind
//!    8, naming the hero credited in field 5; its health and respawns are already the
//!    Mid-Boss objective track above.
//!
//! And one quiet one: an item bought or sold ([`MSG_ABILITIES_CHANGED`]), a couple of
//! hundred per match. Its fields are numbered one lower than the published
//! `CCitadelUserMsg_AbilitiesChanged` says: on the wire, 1 is the buyer's player slot
//! -- their controller's entity index less one, since entity 1 is SourceTV's; read as
//! the index itself, every purchase landed on the next player along -- 2 the item's
//! deadlock-api id and 3 the change: 0 bought, 2 sold, the only two seen on three
//! matches. An upgrade that consumes a component arrives as the
//! new item bought and the component sold on the same tick.
//!
//! # The match clock
//!
//! A replay starts before the match does: the game rules' match clock reads -30 when
//! recording begins, and the game state turns to "in progress" ([`GAME_IN_PROGRESS`])
//! thirty seconds later, which is 0:00 on the in-game clock. Every time in the output
//! is measured from the start of the recording, as the streams are; `clockStart` says
//! where 0:00 falls on that scale. A pause stops the game's clock but not the recording,
//! so `clock` carries the game clock's own anchors -- every time it was set, paused or
//! resumed -- which a viewer interpolates between to show the in-game time at any point.
//! The game rules state the clock as a reading plus the server tick it was taken on;
//! that tick is the server's, not the replay's, so an anchor is placed at the replay
//! tick the update arrived on. One replay measured had a 30 s pause at 5:23: the anchors
//! put the post-match summary's snapshots (taken on the game clock) within 0.3-0.7% of
//! the live net worth, where a flat offset was 4% out after the pause.
//!
//! # Field keys
//!
//! Keys come from `fkey_from_path`, and the path has to include the field's `send_node`
//! prefix. Every per-player statistic on the controller sits under `m_PlayerDataGlobal`;
//! the identity fields next to them do not. A bare name for a prefixed field does not
//! fail loudly -- `get_value` returns `None`, exactly as it would for a field that is
//! genuinely absent -- so the paths below are worth trusting over intuition.
//!
//! A trooper's position turned out to be the same shape as a player pawn's --
//! `CBodyComponent.m_skeletonInstance.m_vecOrigin.<axis>` -- which the ordinary
//! child-index path walk finds directly. The detour worth recording: `send_node` is not
//! attached to whichever level a name like "CBodyComponent" suggests it should be.
//! `CBodyComponent` here has no `send_node` of its own at all; it is the *leaf*
//! (`m_vecX`) that carries `[m_skeletonInstance, m_vecOrigin]`, and a key is built by
//! walking the path top to bottom, folding each level's own `send_node` (if it has one)
//! immediately before that level's name -- so the two happen to end up in the same order
//! the naive path already reads in. Reaching for `send_node` directly and assuming it
//! belongs to the wrapper rather than the leaf produced a field that resolved to nothing
//! on every single lookup; the child-index path was right the whole time. `send_node`
//! is worth inspecting only to break a genuine name collision, such as the second,
//! unrelated field also called `m_vecX`/`m_vecY` elsewhere on this entity (always zero,
//! an AI view offset) -- the same kind of collision `m_PlayerDataGlobal` was.

use haste::demofile::DemoFile;
use haste::entities::{
    deadlock_coord_from_cell, ehandle_to_index, fkey_from_path, is_ehandle_valid, DeltaHeader,
    Entity,
};
use haste::parser::{Context, Parser, Visitor};
use serde::Serialize;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::rc::Rc;
use wasm_bindgen::prelude::*;

mod income;
mod wire;

/// The player controller, one per player, carrying the whole scoreboard row.
const CONTROLLER: u64 = haste::fxhash::hash_bytes(b"CCitadelPlayerController");
/// The hero in the world. Positions live here, not on the controller.
const PAWN: u64 = haste::fxhash::hash_bytes(b"CCitadelPlayerPawn");

// Position, split into a coarse cell and an offset within it.
const CELL_X: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_cellX"]);
const CELL_Y: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_cellY"]);
const CELL_Z: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_cellZ"]);
const VEC_X: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_vecX"]);
const VEC_Y: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_vecY"]);
const VEC_Z: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_vecZ"]);

/// Links a controller to the hero it is driving, so positions can join the scoreboard.
const K_HERO_PAWN: u64 = fkey_from_path(&["m_hHeroPawn"]);

/// The lane creep wave, on both sides.
const TROOPER_LANE: u64 = haste::fxhash::hash_bytes(b"CNPC_Trooper");

// A trooper's position, the same shape as a player pawn's: CBodyComponent, then
// m_skeletonInstance.m_vecOrigin, then the axis. Z is not read: creeps stay on the
// ground and the map is drawn flat. Shared with Guardian below, which turned out to be
// the very same entity class.
const TROOPER_CELL_X: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_cellX"]);
const TROOPER_CELL_Y: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_cellY"]);
const TROOPER_VEC_X: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_vecX"]);
const TROOPER_VEC_Y: u64 = fkey_from_path(&["CBodyComponent", "m_skeletonInstance", "m_vecOrigin", "m_vecY"]);

/// A lane's Guardian. `CNPC_TrooperBoss` -- tried once before as a second kind of
/// creep wave and dropped, on the mistaken read that a stationary unit could not be a
/// trooper. It is not a trooper; it is the tier-one structure defending each lane, which
/// is exactly why it never moves. Same class as a lane trooper in every other respect,
/// down to the field layout, which is why it reuses every constant above.
const GUARDIAN: u64 = haste::fxhash::hash_bytes(b"CNPC_TrooperBoss");

/// A lane's Walker, the tier-two structure behind its Guardian. `CNPC_Boss_Tier2` --
/// same position fields as a trooper, so it reuses the same constants. See the module
/// note on objectives for how its health behaves differently from a Guardian's.
const WALKER: u64 = haste::fxhash::hash_bytes(b"CNPC_Boss_Tier2");

// The remaining objectives, all with the same position fields. See the module note on
// objectives for how each one's health and death behave.
/// The paired guardians around a team's base, six per team.
const BASE_GUARDIAN: u64 = haste::fxhash::hash_bytes(b"CNPC_BarrackBoss");
/// A Shrine, two per team.
const SHRINE: u64 = haste::fxhash::hash_bytes(b"CCitadel_Destroyable_Building");
/// The Patron, one per team; its death ends the match.
const PATRON: u64 = haste::fxhash::hash_bytes(b"CNPC_Boss_Tier3");
/// The neutral Mid-Boss, which respawns as a new entity after each kill.
const MID_BOSS: u64 = haste::fxhash::hash_bytes(b"CNPC_MidBoss");

/// Every objective class and the `kind` it is reported as, in the order they are checked.
const OBJECTIVES: [(u64, &str); 6] = [
    (GUARDIAN, "guardian"),
    (WALKER, "walker"),
    (BASE_GUARDIAN, "baseGuardian"),
    (SHRINE, "shrine"),
    (PATRON, "patron"),
    (MID_BOSS, "midBoss"),
];

/// The one `objective_tracks` key every Mid-Boss life shares. Negative, so it can never
/// collide with a real entity index.
const MID_BOSS_KEY: i32 = -1;

/// One node of a lane's zipline. See the module note on lanes.
const ZIPLINE_NODE: u64 = haste::fxhash::hash_bytes(b"CCitadelZipLineNode");
/// Which lane a node belongs to: 1 is the west lane (York), 4 the middle (Broadway), 6
/// the east (Greenwich).
const K_LANE: u64 = fkey_from_path(&["m_iPrimaryLane"]);
/// A node's place along its rope, from 0 at one end.
const K_NODE_INDEX: u64 = fkey_from_path(&["m_iNodeIndex"]);

/// The neutral camps' creeps, which can also land a killing blow.
const TROOPER_NEUTRAL: u64 = haste::fxhash::hash_bytes(b"CNPC_TrooperNeutral");

/// A hero died. See the module note on events for the fields.
const MSG_HERO_KILLED: u32 = 319;
/// A hero used an ability or an item's active. See the module note on events.
const MSG_ABILITY_CAST: u32 = 365;
/// Something took damage. See the module note on events.
const MSG_DAMAGE: u32 = 300;
/// A weapon fired. See the module note on events.
const MSG_SHOT: u32 = 450;
/// An item was bought or sold. See the module note on events.
const MSG_ABILITIES_CHANGED: u32 = 309;
/// A boss or structure fell. Only the Mid-Boss's is read, for its killer.
const MSG_BOSS_KILLED: u32 = 347;
/// A breakable spawned its debris: a crate or a Sinner's Sacrifice broke.
const MSG_BREAKABLE_DEBRIS: u32 = 500;
/// The post-match summary: see the note in `income`.
const MSG_POST_MATCH: u32 = 316;
/// A breakable prop: a crate or a Golden Statue, by subclass.
const BREAKABLE: u64 = haste::fxhash::hash_bytes(b"CCitadel_BreakableProp");
/// Which kind of breakable prop, by `m_nSubclassID`: see the module note.
const K_SUBCLASS: u64 = fkey_from_path(&["m_nSubclassID"]);
/// `citadel_breakable_item_container`, hashed: a Golden Statue. Any other breakable
/// prop -- `citadel_breakable_prop_wooden_crate` on every match seen -- is a crate.
const SUBCLASS_STATUE: u64 = 3_719_077_267;

/// The game rules, where the match clock lives.
const GAME_RULES: u64 = haste::fxhash::hash_bytes(b"CCitadelGameRulesProxy");
const K_GAME_STATE: u64 = fkey_from_path(&["m_pGameRules", "m_eGameState"]);
/// `m_eGameState` once the match is under way: its clock reads 0:00.
const GAME_IN_PROGRESS: u64 = 7;
/// The game clock: a reading, the server tick it was taken on, and whether it is paused.
const K_CLOCK_AT: u64 = fkey_from_path(&["m_pGameRules", "m_flMatchClockAtLastUpdate"]);
const K_CLOCK_TICK: u64 = fkey_from_path(&["m_pGameRules", "m_nMatchClockUpdateTick"]);
const K_PAUSED: u64 = fkey_from_path(&["m_pGameRules", "m_bGamePaused"]);
/// A Sinner's Sacrifice.
const SINNER: u64 = haste::fxhash::hash_bytes(b"CNPC_Neutral_SinnersSacrifice");
/// A crate break is credited to the nearest hero only if they are this close, in world
/// units; further, it is left uncredited rather than guessed.
const CRATE_CREDIT_RANGE: f32 = 600.0;
/// A hero's hit on a Sinner's Sacrifice counts towards breaking it for this long.
const SINNER_CREDIT_SECONDS: f32 = 10.0;
/// `MSG_BOSS_KILLED`'s kind (field 4) for the Mid-Boss.
const BOSS_KIND_MID_BOSS: u64 = 8;

/// The Urn lying on the map, waiting to be picked up.
const URN: u64 = haste::fxhash::hash_bytes(b"CCitadelItemPickupIdol");
/// The Urn being carried: an ability on the carrier's hero.
const URN_CARRIED: u64 = haste::fxhash::hash_bytes(b"CCitadel_Ability_GoldenIdol");
/// Who holds an ability.
const K_OWNER: u64 = fkey_from_path(&["m_hOwnerEntity"]);

/// `MSG_ABILITIES_CHANGED`'s change field for a purchase, and for a sale.
const CHANGE_BOUGHT: u64 = 0;
const CHANGE_SOLD: u64 = 2;

/// A damage message's kind (field 4) when the hit came from a weapon.
const DAMAGE_KIND_BULLET: u64 = 1;

/// Shots closer together than this are one burst of fire. Long enough to bridge the
/// gap between shots of the slowest automatic weapons, short enough that two separate
/// engagements a beat apart do not run together.
const FIRE_GAP_SECONDS: f32 = 0.4;

/// What an entity in a damage record can be, and the order `Events::kinds` lists them
/// in. "hero" is first, so a player's own kind is always 0.
const KINDS: [&str; 10] = [
    "hero",
    "trooper",
    "neutral",
    "guardian",
    "walker",
    "baseGuardian",
    "shrine",
    "patron",
    "midBoss",
    "other",
];

/// 0 while alive. A death signal, kept second to `m_iHealth` reaching zero rather than
/// in front of it -- see the note on `on_creep` for why checking health first turned out
/// to matter. Still catches close to 4800 distinct transitions on a real match, well
/// past either a fresh `CREATE` (1471) or a position jump past [`CREEP_RESET_DIST`]
/// caught on their own -- a trooper dying in place, mid-lane, raises neither of those.
const K_LIFE_STATE: u64 = fkey_from_path(&["m_lifeState"]);

// Health, also on the pawn rather than the controller. Both are top-level fields with no
// `send_node` prefix.
//
// `m_iHealth` can run past `m_iMaxHealth` -- measured on a real match, close to half of
// all sampled frames had it, by tens or even hundreds of percent, not as a rounding
// artefact but sustained for minutes on specific players. That is consistent with a
// temporary bonus-health source adding straight to current health without raising the
// cap, which is a fairly ordinary thing for a MOBA to have; nothing else on the pawn
// looked like a second, correct max. Either way a bar has to clamp at full, so the
// consuming side does that rather than this parser guessing which number is "wrong".
const K_HP: u64 = fkey_from_path(&["m_iHealth"]);
const K_MAX_HP: u64 = fkey_from_path(&["m_iMaxHealth"]);

/// Where the hero is looking: pitch, yaw, roll in degrees. Only yaw is kept -- the map
/// is flat. Source's convention, confirmed on a real match: 0 is world +x and it turns
/// counter-clockwise, so 90 is +y (north). Checked against the direction players run,
/// which it matched to a median of 8 degrees; the body's own `m_angRotation` was about
/// 180 degrees off the same test, so it is not a stand-in for this.
const K_EYE_ANGLES: u64 = fkey_from_path(&["m_angEyeAngles"]);

// Identity, stored directly on the controller.
const K_NAME: u64 = fkey_from_path(&["m_iszPlayerName"]);
const K_STEAM_ID: u64 = fkey_from_path(&["m_steamID"]);
const K_TEAM: u64 = fkey_from_path(&["m_iTeamNum"]);
const K_SLOT: u64 = fkey_from_path(&["m_unLobbyPlayerSlot"]);

// Everything the scoreboard counts, under the controller's player-data group.
const K_HERO: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_nHeroID"]);
/// The ranked badge the player entered the match with: tier * 10 + subtier (1-6), so
/// 116 is tier 11, subtier 6. Sent once at the start, so even a cut-short replay has it.
/// 0 when unranked. (`m_nCurrentRank` beside it is always 0 in replays.)
const K_RANK: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_unPackedRank"]);
const K_KILLS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iPlayerKills"]);
const K_DEATHS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iDeaths"]);
const K_ASSISTS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iPlayerAssists"]);
const K_NET_WORTH: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iGoldNetWorth"]);
const K_HERO_DAMAGE: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iHeroDamage"]);
const K_OBJ_DAMAGE: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iObjectiveDamage"]);
const K_HEALING: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iHeroHealing"]);
const K_LAST_HITS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iLastHits"]);
const K_DENIES: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iDenies"]);
const K_LEVEL: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iLevel"]);
const K_ALIVE: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_bAlive"]);

/// Seconds of match time between frames.
///
/// One second is the rate at which the scoreboard is worth sampling: it is the finest
/// step a viewer can perceive as continuous, and it makes 1x playback real time. Finer
/// costs size for detail nothing on this screen can show -- souls are the only figure
/// that moves faster, and not by an amount that is legible between two frames.
const SAMPLE_SECONDS: f32 = 1.0;

/// Position frames per second. See the note on positions at the top of this file.
const POSITION_HZ: f32 = 8.0;

/// World units per stored position step.
const POSITION_QUANT: f32 = 16.0;

/// Above this, in units per second, a step is a teleport rather than running: Deadlock
/// characters move on the order of 400 to 700 u/s on foot. Crossing it raises the frame's
/// cut flag, which tells a viewer not to interpolate into that position.
const TELEPORT_SPEED: f32 = 2000.0;

/// Used when the demo does not state its own tick interval. Deadlock runs at 64 Hz.
const FALLBACK_TICK_INTERVAL: f32 = 1.0 / 64.0;

/// Creep frames per second. Slower than a player's: nobody tracks one trooper's dodges
/// across the map, and there are a couple of orders of magnitude more of them.
const CREEP_HZ: f32 = 2.0;

/// Above this distance between two consecutive updates, a creep did not walk there -- it
/// was reset to a spawn point. Measured: the ordinary lane trooper's small pool of entity
/// slots is recycled for a new wave via a fresh `CREATE` far more often than a real
/// `DELETE`, but not always -- about one life in eight, on a real match, was really
/// several waves stitched together under one identity, caught only by this distance
/// check and not by the lifecycle event. No time normalisation the way a player's
/// `TELEPORT_SPEED` needs one: creeps update almost every tick they are alive, and walk
/// slowly, so any single-update jump this large is already far past what one tick of
/// walking could cover.
const CREEP_RESET_DIST: f32 = 1200.0;

/// A creep this long without a real update is drawn dead, not standing still.
///
/// A trooper near death, out of every spectated player's area of interest, can simply
/// stop being sent by the demo altogether -- the game does not owe a replay updates for
/// something nobody is watching. Measured on a real match: one trooper's last real
/// update was at 6 hp, then nothing arrived for 19 seconds until its slot was reused for
/// the next wave's `CREATE`, and for all of that gap the old position was the only thing
/// there was to draw -- a corpse that was probably already gone, stood on the lane for
/// as long as nobody was there to see it fall. Two seconds is well past any ordinary
/// network jitter between real updates (which arrive on nearly every tick a trooper is
/// actually alive and watched) but far short of a slot's typical reuse gap.
const CREEP_STALE_SECONDS: f32 = 2.0;

/// Who a player is. Fixed for the match, so it is said once rather than per frame.
#[derive(Serialize)]
struct Player {
    slot: u32,
    #[serde(rename = "steamId")]
    steam_id: String,
    name: String,
    #[serde(rename = "heroId")]
    hero_id: u32,
    /// 2 is the Amber Hand, 3 the Sapphire Flame.
    team: u32,
    /// Ranked badge at match start, tier * 10 + subtier; 0 when unranked.
    rank: u32,
}

/// Every statistic, as one array per player of one value per frame.
///
/// Indices line up with `players`, and within each array with the frame number, so
/// reading a scoreboard row is a pair of lookups and no searching.
#[derive(Default, Serialize)]
struct Series {
    kills: Vec<Vec<i32>>,
    deaths: Vec<Vec<i32>>,
    assists: Vec<Vec<i32>>,
    #[serde(rename = "netWorth")]
    net_worth: Vec<Vec<i32>>,
    #[serde(rename = "heroDamage")]
    hero_damage: Vec<Vec<i32>>,
    #[serde(rename = "objectiveDamage")]
    objective_damage: Vec<Vec<i32>>,
    healing: Vec<Vec<i32>>,
    #[serde(rename = "lastHits")]
    last_hits: Vec<Vec<i32>>,
    denies: Vec<Vec<i32>>,
    level: Vec<Vec<i32>>,
    /// 0 or 1. A number so every series is the same kind of array.
    alive: Vec<Vec<i32>>,
}

/// Where everyone was, eight times a second.
///
/// Coordinates are whole multiples of `quant` world units: multiply to get world space.
/// Indices line up with `players`, and within each array with the position frame number.
#[derive(Default, Serialize)]
struct Positions {
    /// Position frames per second.
    hz: f32,
    /// World units per stored step.
    quant: f32,
    /// Number of position frames; every array below has this length.
    frames: usize,
    x: Vec<Vec<i32>>,
    y: Vec<Vec<i32>>,
    z: Vec<Vec<i32>>,
    /// 1 where the player jumped into this frame -- a zip line, teleport or respawn.
    /// A viewer should snap to such a frame rather than interpolate into it.
    cut: Vec<Vec<i32>>,
    /// Current health. Can exceed `maxHp` -- see the note on `K_HP` -- so a consumer
    /// should clamp the ratio to 1 rather than trust it to stay under 100%.
    hp: Vec<Vec<i32>>,
    #[serde(rename = "maxHp")]
    max_hp: Vec<Vec<i32>>,
    /// Where the player is looking, in whole degrees: 0 is east (world +x), 90 north,
    /// counter-clockwise. A degree is finer than a minimap marker can show, and whole
    /// numbers keep the stream as small as the rest.
    yaw: Vec<Vec<i32>>,
}

/// One creep's whole life, start to death or the end of the match.
///
/// Unlike a player, a creep is not a fixed track padded to the match length -- there can
/// be a couple of thousand of these, each alive for under a minute, so every one only
/// costs what its own lifetime is worth. `x`/`y` begin at `startFrame` on the creep
/// clock ([`Creeps::hz`]) and run one entry per frame for as long as it existed.
#[derive(Serialize)]
struct Creep {
    /// 2 is the Amber Hand, 3 the Sapphire Flame.
    team: u32,
    #[serde(rename = "startFrame")]
    start_frame: usize,
    x: Vec<i32>,
    y: Vec<i32>,
}

/// Every creep that existed at any point in the match.
#[derive(Default, Serialize)]
struct Creeps {
    /// Creep frames per second -- its own clock, slower than a player's.
    hz: f32,
    /// World units per stored step. Shared with player positions.
    quant: f32,
    lives: Vec<Creep>,
}

/// One objective's whole match: a fixed position and its health over time.
///
/// Indices line up with `Objectives::list`'s own order, and each array here with the
/// scoreboard's frame number -- the same clock `Series` uses, not a creep's or a
/// player's, because nothing about a structure changes fast enough to need either.
#[derive(Serialize)]
struct Objective {
    /// One of the kinds in [`OBJECTIVES`]. A new kind is added alongside, never by
    /// changing what an existing one means.
    kind: &'static str,
    /// 2 is the Amber Hand, 3 the Sapphire Flame.
    team: u32,
    /// A single point, not an array: no objective moves, so there is nothing here for a
    /// frame index to select between.
    x: i32,
    y: i32,
    hp: Vec<i32>,
    #[serde(rename = "maxHp")]
    max_hp: Vec<i32>,
}

/// Every objective the match ever had.
#[derive(Default, Serialize)]
struct Objectives {
    /// World units per stored position step. Shared with player and creep positions.
    quant: f32,
    list: Vec<Objective>,
}

/// One lane's zipline: where its nodes are, and who could ride each part of it when.
#[derive(Serialize)]
struct Lane {
    /// 1 is the west lane (York), 4 the middle (Broadway), 6 the east (Greenwich).
    lane: i64,
    /// Node positions in rope order. A node never moves, so each is a single point.
    x: Vec<i32>,
    y: Vec<i32>,
    /// `[frame, node, team]`, in frame order: from scoreboard frame `frame` on, node
    /// `node` (an index into `x`/`y`) belongs to `team` -- 2 Amber, 3 Sapphire, 0
    /// nobody. Every node is unowned until its first change.
    changes: Vec<[i32; 3]>,
}

#[derive(Default, Serialize)]
struct Lanes {
    /// World units per stored position step. Shared with every other position.
    quant: f32,
    list: Vec<Lane>,
}

/// Every hero death, one entry per death across all the arrays, in time order.
///
/// Player fields are indices into `Timeline::players`, or -1 where the entity was not
/// a player's hero.
#[derive(Default, Serialize)]
struct Kills {
    /// When, in ticks from the start of the match's clock -- see `Events::hz`.
    t: Vec<i32>,
    victim: Vec<i32>,
    /// The hero credited with the kill, or -1 for a death nobody was credited with.
    killer: Vec<i32>,
    /// What landed the killing blow, which is not always the killer: "hero", "trooper",
    /// "neutral", one of the objective kinds in [`OBJECTIVES`], or "other".
    cause: Vec<&'static str>,
    assisters: Vec<Vec<i32>>,
    /// Where the victim was when they died, in `Events::quant` steps.
    x: Vec<i32>,
    y: Vec<i32>,
}

/// Every ability and item active used, one entry per cast, in time order.
#[derive(Default, Serialize)]
struct Casts {
    /// Ticks from the start of the match's clock, the same as `Kills::t`.
    t: Vec<i32>,
    /// Index into `Timeline::players`.
    player: Vec<i32>,
    /// Index into `Events::abilities`.
    ability: Vec<i32>,
    /// Where the caster was, in `Events::quant` steps.
    x: Vec<i32>,
    y: Vec<i32>,
}

/// Every hit a hero dealt or took, one entry per hit, in time order. Hits with the same
/// attacker, victim and source on the same tick -- a shotgun's pellets -- are one entry.
#[derive(Default, Serialize)]
struct Damage {
    t: Vec<i32>,
    /// Who dealt it: an index into `Timeline::players`, or -1 for something not a hero.
    from: Vec<i32>,
    /// What dealt it, as an index into `Events::kinds`; 0 wherever `from` is a player.
    #[serde(rename = "fromKind")]
    from_kind: Vec<i32>,
    to: Vec<i32>,
    #[serde(rename = "toKind")]
    to_kind: Vec<i32>,
    amount: Vec<i32>,
    /// Index into `Events::sources`, or -1 for a hit that named none.
    source: Vec<i32>,
}

/// Every item bought or sold, in time order.
#[derive(Default, Serialize)]
struct Items {
    t: Vec<i32>,
    /// Index into `Timeline::players`.
    player: Vec<i32>,
    /// The item's deadlock-api id.
    id: Vec<u32>,
    /// 1 for a sale -- or a component consumed by an upgrade bought on the same tick --
    /// 0 for a purchase.
    sold: Vec<i32>,
}

/// Every neutral creep that spawned, in time order.
#[derive(Default, Serialize)]
struct Neutrals {
    t: Vec<i32>,
    x: Vec<i32>,
    y: Vec<i32>,
    /// When its death was seen, or -1 where it never was.
    died: Vec<i32>,
}

/// Everything that happened to the Urn, in time order.
#[derive(Default, Serialize)]
struct Urn {
    t: Vec<i32>,
    /// "spawn", "pickup", "drop" or "deliver".
    kind: Vec<&'static str>,
    /// Index into `Timeline::players` for a pickup, drop or delivery; -1 for a spawn.
    player: Vec<i32>,
    x: Vec<i32>,
    y: Vec<i32>,
}

/// Every crate, or every Sinner's Sacrifice, that stood in the match: one entry per
/// life, in the order they spawned.
#[derive(Default, Serialize)]
struct Breakables {
    /// When it spawned, in ticks.
    t: Vec<i32>,
    x: Vec<i32>,
    y: Vec<i32>,
    /// When it broke, or -1 if it was still standing at the end.
    broken: Vec<i32>,
    /// Who broke it -- an index into `Timeline::players` -- or -1 when nobody could be
    /// credited. See the module note on the map's timers for how each kind is credited.
    by: Vec<i32>,
}

/// Each time the Mid-Boss fell, and to whom.
#[derive(Default, Serialize)]
struct MidBossKills {
    t: Vec<i32>,
    /// Index into `Timeline::players`, or -1 when no hero was credited.
    player: Vec<i32>,
}

/// Which list a breakable belongs in.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Breakable {
    Crate,
    Statue,
    Sinner,
}

/// Moments rather than state: see the module note on events.
#[derive(Default, Serialize)]
struct Events {
    /// Ticks per second. An event at `t` is `t / hz` seconds into the match, on the
    /// same clock as every sampled stream.
    hz: f32,
    /// World units per stored position step. Shared with every other position.
    quant: f32,
    /// Internal ability names, each stated once; a cast refers to one by index.
    abilities: Vec<String>,
    kills: Kills,
    casts: Casts,
    /// Per player, when they were firing: `[start, end, start, end, ...]` in ticks. A
    /// burst of one shot has its start equal to its end.
    firing: Vec<Vec<i32>>,
    damage: Damage,
    /// The kinds of thing that can deal or take damage; see [`KINDS`].
    kinds: Vec<&'static str>,
    /// deadlock-api ids of the abilities, items and weapons damage came from, each stated
    /// once; a hit refers to one by index.
    sources: Vec<u32>,
    items: Items,
    neutrals: Neutrals,
    urn: Urn,
    #[serde(rename = "midBossKills")]
    mid_boss_kills: MidBossKills,
    crates: Breakables,
    sinners: Breakables,
    statues: Breakables,
}

/// A point the game clock was set at. Between anchors it runs with the recording, unless
/// paused.
#[derive(Serialize)]
struct ClockAnchor {
    /// Seconds into the recording.
    t: f32,
    /// The game clock's reading then, in seconds.
    game: f32,
    paused: bool,
}

#[derive(Serialize)]
struct Timeline {
    /// Seconds from the start of the recording to 0:00 on the in-game clock. See the
    /// module note on the match clock.
    #[serde(rename = "clockStart")]
    clock_start: f32,
    /// The game clock, pauses included. See the module note on the match clock.
    clock: Vec<ClockAnchor>,
    /// Seconds of match time per frame.
    #[serde(rename = "sampleSeconds")]
    sample_seconds: f32,
    /// Match length in seconds.
    duration: i32,
    /// Number of frames; every series array has this length.
    frames: usize,
    players: Vec<Player>,
    series: Series,
    positions: Positions,
    creeps: Creeps,
    objectives: Objectives,
    lanes: Lanes,
    events: Events,
    /// Souls earned, by source. See the note in `income`.
    income: income::Income,
}

/// One player's identity and current values, as the parse walks the match.
#[derive(Default, Clone)]
struct Row {
    slot: u32,
    steam_id: u64,
    name: String,
    hero_id: u32,
    team: u32,
    rank: u32,
    kills: i32,
    deaths: i32,
    assists: i32,
    net_worth: i32,
    hero_damage: i32,
    objective_damage: i32,
    healing: i32,
    last_hits: i32,
    denies: i32,
    level: i32,
    alive: i32,
    /// Entity index of the hero this controller drives, or -1 before one is assigned.
    pawn: i32,
}

/// One hero's position stream, as the parse walks the match.
#[derive(Default)]
struct Track {
    x: Vec<i32>,
    y: Vec<i32>,
    z: Vec<i32>,
    cut: Vec<i32>,
    hp: Vec<i32>,
    max_hp: Vec<i32>,
    yaw: Vec<i32>,
    /// Current position, carried between frames: a standing player sends no update, so
    /// the last known value is the right one to sample.
    at: [f32; 3],
    /// Current health, carried the same way and for the same reason.
    hp_at: i32,
    max_hp_at: i32,
    /// Current view yaw, carried the same way.
    yaw_at: f32,
    seen: bool,
    /// Raised at full tick rate, consumed by the next sampled frame.
    jumped: bool,
    /// Previous position and tick, for the speed test that raises `jumped`.
    prev: [f32; 3],
    prev_tick: i32,
}

/// One creep's life, as the parse walks the match. Opened on `DeltaHeader::CREATE`,
/// closed on `DeltaHeader::DELETE`; see the module note on creeps for why this is a
/// growing record rather than a fixed track like a player's.
#[derive(Default)]
struct CreepTrack {
    team: u32,
    /// Set the first time this life is sampled, once its own frame 0 is known.
    start_frame: Option<usize>,
    x: Vec<i32>,
    y: Vec<i32>,
    /// Current position, carried between frames the same way a player's is.
    at: [f32; 2],
    seen: bool,
    /// The tick of the last real update this life got, for [`CREEP_STALE_SECONDS`].
    last_seen_tick: i32,
}

/// One zipline node, as the parse walks the match.
#[derive(Default)]
struct ZiplineTrack {
    lane: i64,
    node: i64,
    /// Set once, the first time a position resolves: a node does not move.
    at: Option<[f32; 2]>,
    team: u32,
    /// `(frame, team)` for every change of owner, first ownership included.
    changes: Vec<(usize, u32)>,
}

/// One objective's life, as the parse walks the match. Unlike a creep's, this is never
/// finalised early -- it just accumulates one hp/maxHp sample per second for as long as
/// the entity exists, which past destruction is "for the rest of the match", since
/// nothing further arrives to change a value that is simply carried forward.
#[derive(Default)]
struct ObjectiveTrack {
    kind: &'static str,
    /// The entity currently feeding this track. Fixed for every kind but the Mid-Boss,
    /// which moves to a new entity with each life.
    entity: i32,
    team: u32,
    /// Set once, the first time a position resolves: an objective does not move, so
    /// there is nothing to update it with afterwards.
    at: Option<[f32; 2]>,
    /// Latched on the first sign of death and never cleared: health alone can climb back
    /// off zero after it -- see the module note on objectives.
    destroyed: bool,
    hp_at: i32,
    max_hp_at: i32,
    hp: Vec<i32>,
    max_hp: Vec<i32>,
}

#[derive(Default)]
struct State {
    /// Keyed by entity index: a controller keeps its index for the whole match.
    rows: BTreeMap<i32, Row>,
    /// Entity indices in the order they became real players, fixing the output order.
    order: Vec<i32>,
    series: Series,
    frames: usize,
    first_tick: Option<i32>,
    last_tick: i32,
    next_sample_tick: i32,
    ticks_per_sample: i32,

    /// Keyed by pawn entity index, which is what a position update carries.
    tracks: BTreeMap<i32, Track>,
    position_frames: usize,
    next_position_tick: i32,
    ticks_per_position: i32,
    tick_interval: f32,

    /// Open creep lives, keyed by entity index. An index is reused once its previous
    /// occupant is deleted, which is exactly when this map drops it too.
    creep_tracks: BTreeMap<i32, CreepTrack>,
    /// Finished lives: closed by a delete, or by the match ending while still open.
    creep_lives: Vec<Creep>,
    creep_frames: usize,
    next_creep_tick: i32,
    ticks_per_creep: i32,

    /// Keyed by entity index, except the Mid-Boss's shared [`MID_BOSS_KEY`]. Unlike a
    /// creep, there is no equivalent of `finish_creep` here: an entry just accumulates
    /// for the whole match and is read out once, at the end, in `parse_scoreboard`.
    objective_tracks: BTreeMap<i32, ObjectiveTrack>,
    /// Entity indices in the order they first appeared, fixing the output order the
    /// same way `order` does for players.
    objective_order: Vec<i32>,

    /// Keyed by entity index: a zipline node keeps its entity for the whole match.
    zipline_tracks: BTreeMap<i32, ZiplineTrack>,

    /// The tick the sampled streams' frame 0 was taken on, which an event's time is
    /// measured from so that it lands on the same clock.
    start_tick: Option<i32>,
    /// Kills and casts as they arrive, with `t` still an absolute tick until the end of
    /// the parse, when `start_tick` is certain to be known.
    events: Events,
    /// An ability name's place in `events.abilities`.
    ability_ids: BTreeMap<String, i32>,
    /// A damage source id's place in `events.sources`.
    source_ids: BTreeMap<u32, i32>,

    /// Every neutral creep that spawned: tick and position. Grouped into camps at the end.
    neutral_spawns: Vec<(i32, [f32; 2])>,
    /// When each spawn's death was seen, by its place in `neutral_spawns`.
    neutral_deaths: Vec<Option<i32>>,
    /// Spawns still alive as far as is known, by entity index.
    neutral_open: BTreeMap<i32, usize>,
    /// The tick the carried Urn last disappeared, and who had it, for telling a drop
    /// (a pickup appears where they fell) from a delivery (nothing appears).
    urn_released: Option<(i32, i32)>,
    /// Standing crates, statues and Sinner's Sacrifices, by entity index: which kind,
    /// and the life's place in that kind's list.
    breakable_open: BTreeMap<i32, (Breakable, usize)>,
    /// The last hero to hit each standing Sinner's Sacrifice, and when.
    sinner_hit: BTreeMap<i32, (i32, i32)>,
    /// The tick the game state turned to in progress: 0:00 on the in-game clock.
    game_start: Option<i32>,
    /// The game rules' clock fields as last seen: reading, server tick, paused.
    clock_fields: (f32, i64, bool),
    /// Clock anchors as `(tick, reading, paused)`.
    clock: Vec<(i32, f32, bool)>,
    /// Net worth and the evidence of where it came from.
    income: income::Collect,
}

/// Appends `value` to `column`, growing the table if this player is new.
///
/// A player whose controller appears after sampling began is backfilled with zeros, so
/// every array stays the same length and a frame index means the same thing in all of
/// them.
fn push(column: &mut Vec<Vec<i32>>, player: usize, frames: usize, value: i32) {
    if column.len() <= player {
        column.resize(player + 1, Vec::new());
    }
    let series = &mut column[player];
    series.resize(frames, 0);
    series.push(value);
}

impl Events {
    fn breakables(&mut self, kind: Breakable) -> &mut Breakables {
        match kind {
            Breakable::Crate => &mut self.crates,
            Breakable::Statue => &mut self.statues,
            Breakable::Sinner => &mut self.sinners,
        }
    }
}

impl State {
    /// Records one frame, but only once there is a scoreboard worth recording.
    ///
    /// The opening seconds of a replay have controllers that exist without a hero picked
    /// or a name resolved, and frames taken then would be a scoreboard of blanks in front
    /// of the real one.
    fn sample(&mut self, tick: i32) {
        // Fix the output order the first time each player becomes real.
        for (&index, row) in self.rows.iter() {
            if named(row) && !self.order.contains(&index) {
                self.order.push(index);
            }
        }
        if self.order.is_empty() {
            return;
        }
        self.first_tick.get_or_insert(tick);

        let frames = self.frames;
        // Collected first: `order` borrows self immutably while `series` needs it mutably.
        let values: Vec<Row> = self
            .order
            .iter()
            .map(|index| self.rows.get(index).cloned().unwrap_or_default())
            .collect();

        for (player, row) in values.iter().enumerate() {
            push(&mut self.series.kills, player, frames, row.kills);
            push(&mut self.series.deaths, player, frames, row.deaths);
            push(&mut self.series.assists, player, frames, row.assists);
            push(&mut self.series.net_worth, player, frames, row.net_worth);
            push(&mut self.series.hero_damage, player, frames, row.hero_damage);
            push(
                &mut self.series.objective_damage,
                player,
                frames,
                row.objective_damage,
            );
            push(&mut self.series.healing, player, frames, row.healing);
            push(&mut self.series.last_hits, player, frames, row.last_hits);
            push(&mut self.series.denies, player, frames, row.denies);
            push(&mut self.series.level, player, frames, row.level);
            push(&mut self.series.alive, player, frames, row.alive);
        }

        // Fix an objective's place in the output order the first time it has a real
        // position, the same way a player's row has to be named first.
        for (&index, track) in self.objective_tracks.iter() {
            if track.at.is_some() && !self.objective_order.contains(&index) {
                self.objective_order.push(index);
            }
        }
        for &index in &self.objective_order {
            let Some(track) = self.objective_tracks.get_mut(&index) else {
                continue;
            };
            track.hp.resize(frames, 0);
            track.max_hp.resize(frames, 0);
            track.hp.push(track.hp_at);
            track.max_hp.push(track.max_hp_at);
        }

        self.frames += 1;
    }

    /// Records one position frame for every hero seen so far.
    ///
    /// A hero that has not appeared yet is skipped rather than written as a zero, and is
    /// padded when it does appear, so a player who spawns late does not spend the opening
    /// of the match sitting at the map origin.
    fn sample_positions(&mut self) {
        let frames = self.position_frames;
        for track in self.tracks.values_mut() {
            if !track.seen {
                continue;
            }
            track.x.resize(frames, 0);
            track.y.resize(frames, 0);
            track.z.resize(frames, 0);
            track.cut.resize(frames, 0);
            track.hp.resize(frames, 0);
            track.max_hp.resize(frames, 0);
            track.yaw.resize(frames, 0);

            track.x.push((track.at[0] / POSITION_QUANT).round() as i32);
            track.y.push((track.at[1] / POSITION_QUANT).round() as i32);
            track.z.push((track.at[2] / POSITION_QUANT).round() as i32);
            track.cut.push(track.jumped as i32);
            track.jumped = false;
            track.hp.push(track.hp_at);
            track.max_hp.push(track.max_hp_at);
            track.yaw.push(track.yaw_at.rem_euclid(360.0).round() as i32 % 360);
        }
        self.position_frames += 1;
    }

    /// Records one frame for every creep alive right now.
    ///
    /// Unlike a player's track, a creep's arrays are never padded before this life's own
    /// first sample -- there is no shared frame count for creeps to line up against, so
    /// each one just starts at whichever frame it first existed on.
    ///
    /// A life with nothing since [`CREEP_STALE_SECONDS`] ago is closed first, rather than
    /// sampled: it has gone quiet, not necessarily died, but a position that old is not
    /// this creep's position any more, and the only alternative to closing the life is
    /// drawing a corpse standing where it was last seen for however long the quiet lasts.
    fn sample_creeps(&mut self, tick: i32) {
        let interval = if self.tick_interval > 0.0 {
            self.tick_interval
        } else {
            FALLBACK_TICK_INTERVAL
        };
        let stale: Vec<i32> = self
            .creep_tracks
            .iter()
            .filter(|(_, track)| {
                track.seen && (tick - track.last_seen_tick) as f32 * interval > CREEP_STALE_SECONDS
            })
            .map(|(&index, _)| index)
            .collect();
        for index in stale {
            finish_creep(self, index);
        }

        let frame = self.creep_frames;
        for track in self.creep_tracks.values_mut() {
            if !track.seen {
                continue;
            }
            track.start_frame.get_or_insert(frame);
            track.x.push((track.at[0] / POSITION_QUANT).round() as i32);
            track.y.push((track.at[1] / POSITION_QUANT).round() as i32);
        }
        self.creep_frames += 1;
    }

    /// The player driving the hero at entity `pawn`, as an index into the output's
    /// player list, or -1 if it is no player's hero.
    ///
    /// Looked up at the moment of the event rather than at the end of the parse: a
    /// controller's pawn is read fresh on every update, so the link that holds now is
    /// the one that was true when this happened.
    fn player_of_pawn(&self, pawn: i32) -> i32 {
        self.order
            .iter()
            .position(|index| self.rows.get(index).is_some_and(|row| row.pawn == pawn))
            .map_or(-1, |p| p as i32)
    }

    /// Where the hero at entity `pawn` is right now, in stored position steps.
    /// The player whose hero stands nearest `at`, if within `range` world units; else -1.
    fn nearest_player(&self, at: [f32; 2], range: f32) -> i32 {
        let mut best = (-1, range * range);
        for (player, index) in self.order.iter().enumerate() {
            let Some(track) = self.rows.get(index).and_then(|row| self.tracks.get(&row.pawn)) else {
                continue;
            };
            if track.hp_at <= 0 {
                continue;
            }
            let d = dist2([track.at[0], track.at[1]], at);
            if d < best.1 {
                best = (player as i32, d);
            }
        }
        best.0
    }

    fn pawn_at(&self, pawn: i32) -> [i32; 2] {
        let at = self.tracks.get(&pawn).map(|t| t.at).unwrap_or_default();
        [
            (at[0] / POSITION_QUANT).round() as i32,
            (at[1] / POSITION_QUANT).round() as i32,
        ]
    }

    /// Extends `player`'s current burst of fire to `tick`, or opens a new one if the
    /// last ended more than [`FIRE_GAP_SECONDS`] ago.
    fn fired(&mut self, player: i32, tick: i32) {
        let gap = (FIRE_GAP_SECONDS / self.interval()).round() as i32;
        let firing = &mut self.events.firing;
        if firing.len() <= player as usize {
            firing.resize(player as usize + 1, Vec::new());
        }
        let bursts = &mut firing[player as usize];
        match bursts.len() {
            n if n >= 2 && tick - bursts[n - 1] <= gap => bursts[n - 1] = bursts[n - 1].max(tick),
            _ => bursts.extend([tick, tick]),
        }
    }

    fn source_id(&mut self, id: u32) -> i32 {
        if let Some(&index) = self.source_ids.get(&id) {
            return index;
        }
        let index = self.events.sources.len() as i32;
        self.events.sources.push(id);
        self.source_ids.insert(id, index);
        index
    }

    /// Where each player's hero stands, if alive, in output order.
    fn heroes(&self) -> Vec<Option<[f32; 2]>> {
        self.order
            .iter()
            .map(|index| {
                let track = self.rows.get(index).and_then(|row| self.tracks.get(&row.pawn))?;
                (track.seen && track.hp_at > 0).then_some([track.at[0], track.at[1]])
            })
            .collect()
    }

    /// A lane trooper died, if `index` is one still open: its souls went to the heroes near.
    fn trooper_died(&mut self, index: i32, tick: i32) {
        let Some(at) = self.creep_tracks.get(&index).filter(|t| t.seen).map(|t| t.at) else {
            return;
        };
        let heroes = self.heroes();
        self.income.near(&heroes, at, income::SHARE_RANGE, income::LANE, tick);
    }

    /// Notes a new clock anchor if the game rules' clock was set, paused or resumed.
    fn on_clock(&mut self, tick: i32, e: &Entity) {
        let (at, server_tick, paused) = self.clock_fields;
        let now = (
            e.get_value::<f32>(&K_CLOCK_AT).unwrap_or(at),
            e.get_value::<i64>(&K_CLOCK_TICK).unwrap_or(server_tick),
            e.get_value::<bool>(&K_PAUSED).unwrap_or(paused),
        );
        if now == self.clock_fields {
            return;
        }
        self.clock_fields = now;
        // A new reading anchors the clock here; a pause or resume alone carries the last
        // anchor forward to this tick.
        let reading = if now.1 != server_tick || self.clock.is_empty() {
            now.0
        } else {
            let &(t, reading, was_paused) = self.clock.last().unwrap();
            if was_paused { reading } else { reading + (tick - t) as f32 * self.interval() }
        };
        self.clock.push((tick, reading, now.2));
    }

    /// The tick the game clock read `game` seconds, if it ever did while running.
    fn tick_of_game(&self, game: f32) -> Option<i32> {
        let per_second = 1.0 / self.interval();
        for (i, &(t, reading, paused)) in self.clock.iter().enumerate() {
            if paused || game < reading {
                continue;
            }
            let end = self.clock.get(i + 1).map_or(i32::MAX, |next| next.0);
            let tick = t as f32 + (game - reading) * per_second;
            if tick <= end as f32 {
                return Some(tick.round() as i32);
            }
        }
        None
    }

    fn interval(&self) -> f32 {
        if self.tick_interval > 0.0 {
            self.tick_interval
        } else {
            FALLBACK_TICK_INTERVAL
        }
    }

    fn ability_id(&mut self, name: &[u8]) -> i32 {
        let name = String::from_utf8_lossy(name).into_owned();
        if let Some(&id) = self.ability_ids.get(&name) {
            return id;
        }
        let id = self.events.abilities.len() as i32;
        self.events.abilities.push(name.clone());
        self.ability_ids.insert(name, id);
        id
    }
}

/// What kind of thing entity `index` is, for a kill's cause.
fn cause_of(ctx: &Context, index: i32) -> &'static str {
    let Some(e) = ctx.entities().and_then(|all| all.get(&index)) else {
        return "other";
    };
    if e.serializer_name_heq(PAWN) {
        return "hero";
    }
    if e.serializer_name_heq(TROOPER_LANE) {
        return "trooper";
    }
    if e.serializer_name_heq(TROOPER_NEUTRAL) {
        return "neutral";
    }
    OBJECTIVES
        .iter()
        .find(|(class, _)| e.serializer_name_heq(*class))
        .map_or("other", |&(_, kind)| kind)
}

/// One axis of a position, from the cell it sits in and the offset within that cell.
fn coord(e: &Entity, cell: u64, vec: u64) -> Option<f32> {
    let cell: u16 = e.get_value(&cell)?;
    let offset: f32 = e.get_value(&vec)?;
    Some(deadlock_coord_from_cell(cell, offset))
}

/// A controller that stands for an actual player, rather than the broadcast slot.
fn named(row: &Row) -> bool {
    !row.name.is_empty() && row.name != "SourceTV"
}

/// Closes out whatever creep life is open at `index`, if any, keeping it only if it was
/// actually sampled at least once -- a trooper that spawned and died between two
/// creep-clock ticks leaves nothing worth drawing. Shared by a slot's reuse, a proper
/// delete, and the flush at the end of the match.
fn finish_creep(st: &mut State, index: i32) {
    let Some(track) = st.creep_tracks.remove(&index) else {
        return;
    };
    if let Some(start_frame) = track.start_frame {
        st.creep_lives.push(Creep {
            team: track.team,
            start_frame,
            x: track.x,
            y: track.y,
        });
    }
}

#[derive(Default, Clone)]
struct Collector(Rc<RefCell<State>>);

impl Visitor for Collector {
    fn on_entity(&mut self, ctx: &Context, d: DeltaHeader, e: &Entity) -> anyhow::Result<()> {
        if e.serializer_name_heq(PAWN) {
            self.on_pawn(ctx, e);
            return Ok(());
        }
        if e.serializer_name_heq(TROOPER_LANE) {
            self.on_creep(ctx, d, e);
            return Ok(());
        }
        if e.serializer_name_heq(TROOPER_NEUTRAL) {
            self.on_neutral(ctx, d, e);
            return Ok(());
        }
        if e.serializer_name_heq(BREAKABLE) || e.serializer_name_heq(SINNER) {
            if d == DeltaHeader::CREATE {
                let kind = if e.serializer_name_heq(SINNER) {
                    Breakable::Sinner
                } else if e.get_value::<u64>(&K_SUBCLASS) == Some(SUBCLASS_STATUE) {
                    Breakable::Statue
                } else {
                    Breakable::Crate
                };
                self.on_breakable_spawn(ctx, e, kind);
            }
            return Ok(());
        }
        if e.serializer_name_heq(GAME_RULES) {
            let mut st = self.0.borrow_mut();
            if e.get_value::<u64>(&K_GAME_STATE) == Some(GAME_IN_PROGRESS) {
                st.game_start.get_or_insert(ctx.tick());
            }
            st.on_clock(ctx.tick(), e);
            return Ok(());
        }
        if e.serializer_name_heq(URN) {
            self.on_urn(ctx, d, e);
            return Ok(());
        }
        if e.serializer_name_heq(URN_CARRIED) {
            self.on_urn_carried(ctx, d, e);
            return Ok(());
        }
        if e.serializer_name_heq(ZIPLINE_NODE) {
            self.on_zipline(e);
            return Ok(());
        }
        if let Some(&(class, kind)) = OBJECTIVES.iter().find(|(c, _)| e.serializer_name_heq(*c)) {
            let key = if class == MID_BOSS { MID_BOSS_KEY } else { e.index() };
            self.on_objective(d, e, key, kind);
            return Ok(());
        }
        if !e.serializer_name_heq(CONTROLLER) {
            return Ok(());
        }
        let mut st = self.0.borrow_mut();
        let player = st.order.iter().position(|&i| i == e.index()).map_or(-1, |p| p as i32);
        let row = st.rows.entry(e.index()).or_default();
        let (last_hits, denies) = (row.last_hits, row.denies);

        // An entity delta carries only the fields that changed, but haste hands the
        // visitor the entity's whole current state, so each of these is either the live
        // value or absent because the field has never been sent.
        if let Some(v) = text(e, K_NAME) {
            row.name = v;
        }
        if let Some(v) = e.get_value::<u64>(&K_STEAM_ID) {
            row.steam_id = v;
        }
        if let Some(v) = e.get_value::<u64>(&K_TEAM) {
            row.team = v as u32;
        }
        if let Some(v) = e.get_value::<u64>(&K_SLOT) {
            row.slot = v as u32;
        }
        if let Some(v) = e.get_value::<u64>(&K_HERO) {
            row.hero_id = v as u32;
        }
        if let Some(v) = e.get_value::<u64>(&K_RANK) {
            row.rank = v as u32;
        }
        // These are all I64 on the wire. Asking for i32 would silently yield None:
        // get_value cannot distinguish a failed conversion from a missing field.
        if let Some(v) = e.get_value::<i64>(&K_KILLS) {
            row.kills = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_DEATHS) {
            row.deaths = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_ASSISTS) {
            row.assists = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_NET_WORTH) {
            row.net_worth = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_HERO_DAMAGE) {
            row.hero_damage = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_OBJ_DAMAGE) {
            row.objective_damage = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_HEALING) {
            row.healing = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_LAST_HITS) {
            row.last_hits = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_DENIES) {
            row.denies = v as i32;
        }
        if let Some(v) = e.get_value::<i64>(&K_LEVEL) {
            row.level = v as i32;
        }
        if let Some(v) = e.get_value::<bool>(&K_ALIVE) {
            row.alive = v as i32;
        }
        // The link to the hero in the world, and so to its positions. It is null until a
        // hero is picked and spawned, which is why it is read every update rather than once.
        if let Some(handle) = e.get_value::<u32>(&K_HERO_PAWN) {
            if is_ehandle_valid(handle) {
                row.pawn = ehandle_to_index(handle);
            }
        }
        let (worth, more_hits, more_denies) =
            (row.net_worth, row.last_hits > last_hits, row.denies > denies);
        let tick = ctx.tick();
        st.income.net_worth(player, tick, worth);
        if more_hits {
            st.income.evidence(player, income::LANE, tick);
            st.income.evidence(player, income::NEUTRALS, tick);
        }
        if more_denies {
            st.income.evidence(player, income::DENIES, tick);
        }
        Ok(())
    }

    fn on_tick_end(&mut self, ctx: &Context) -> anyhow::Result<()> {
        let tick = ctx.tick();
        let mut st = self.0.borrow_mut();
        st.last_tick = tick;

        // The demo states its own tick rate, but only once the first packet carrying it
        // has been read, so it is picked up here rather than before the run.
        if st.ticks_per_sample == 0 {
            let interval = match ctx.tick_interval() {
                i if i > 0.0 => i,
                _ => FALLBACK_TICK_INTERVAL,
            };
            st.tick_interval = interval;
            st.ticks_per_sample = (SAMPLE_SECONDS / interval).round().max(1.0) as i32;
            st.ticks_per_position = (1.0 / POSITION_HZ / interval).round().max(1.0) as i32;
            st.ticks_per_creep = (1.0 / CREEP_HZ / interval).round().max(1.0) as i32;
        }

        // Every stream takes its frame 0 on this first tick, so it is the one clock start
        // they all share. Measured, it is also the tick the players are first named on,
        // so the scoreboard's gate in `sample` does not move its start off this one.
        st.start_tick.get_or_insert(tick);

        if tick >= st.next_sample_tick {
            st.next_sample_tick = tick + st.ticks_per_sample;
            st.sample(tick);
        }
        if tick >= st.next_position_tick {
            st.next_position_tick = tick + st.ticks_per_position;
            st.sample_positions();
        }
        if tick >= st.next_creep_tick {
            st.next_creep_tick = tick + st.ticks_per_creep;
            st.sample_creeps(tick);
        }
        Ok(())
    }

    fn on_packet(&mut self, ctx: &Context, packet_type: u32, data: &[u8]) -> anyhow::Result<()> {
        match packet_type {
            MSG_HERO_KILLED => self.on_hero_killed(ctx, data),
            MSG_ABILITY_CAST => self.on_ability_cast(ctx, data),
            MSG_SHOT => self.on_shot(ctx, data),
            MSG_DAMAGE => self.on_damage(ctx, data),
            MSG_ABILITIES_CHANGED => self.on_item(ctx, data),
            MSG_BOSS_KILLED => self.on_boss_killed(ctx, data),
            MSG_BREAKABLE_DEBRIS => self.on_debris(ctx, data),
            MSG_POST_MATCH => {
                self.0.borrow_mut().income.summary = wire::bytes(data, 1).map(<[u8]>::to_vec)
            }
            _ => {}
        }
        Ok(())
    }
}

impl Collector {
    /// Records one hero's death. See the module note on events for the fields.
    fn on_hero_killed(&self, ctx: &Context, data: &[u8]) {
        let Some(victim_pawn) = wire::varint(data, 1) else {
            return;
        };
        let mut st = self.0.borrow_mut();
        let victim = st.player_of_pawn(victim_pawn as i32);
        if victim < 0 {
            return;
        }
        let killer = wire::varint(data, 5).map_or(-1, |pawn| st.player_of_pawn(pawn as i32));
        let cause = wire::varint(data, 2).map_or("other", |index| cause_of(ctx, index as i32));
        let assisters: Vec<i32> = wire::varints(data, 4)
            .map(|pawn| st.player_of_pawn(pawn as i32))
            .filter(|&p| p >= 0)
            .collect();
        let [x, y] = st.pawn_at(victim_pawn as i32);
        let tick = ctx.tick();
        if killer >= 0 && killer != victim {
            st.income.evidence(killer, income::KILLS, tick);
        }
        for &a in &assisters {
            st.income.evidence(a, income::ASSISTS, tick);
        }

        let kills = &mut st.events.kills;
        kills.t.push(ctx.tick());
        kills.victim.push(victim);
        // Credited to the victim themselves, it was a suicide, which is nobody's kill.
        kills.killer.push(if killer == victim { -1 } else { killer });
        kills.cause.push(cause);
        kills.assisters.push(assisters);
        kills.x.push(x);
        kills.y.push(y);
    }

    /// Tracks one neutral creep's life. See the module note on the map's timers.
    fn on_neutral(&self, ctx: &Context, d: DeltaHeader, e: &Entity) {
        let mut st = self.0.borrow_mut();
        let tick = ctx.tick();
        if d == DeltaHeader::CREATE {
            // The slot's previous creep died unseen; its death stays unknown.
            st.neutral_open.remove(&e.index());
            let at = match (
                coord(e, TROOPER_CELL_X, TROOPER_VEC_X),
                coord(e, TROOPER_CELL_Y, TROOPER_VEC_Y),
            ) {
                (Some(x), Some(y)) => [x, y],
                _ => return,
            };
            let n = st.neutral_spawns.len();
            st.neutral_spawns.push((tick, at));
            st.neutral_deaths.push(None);
            st.neutral_open.insert(e.index(), n);
            return;
        }
        let dead = d == DeltaHeader::DELETE
            || e.get_value::<i64>(&K_HP).is_some_and(|hp| hp <= 0)
            || e.get_value::<u64>(&K_LIFE_STATE).unwrap_or(0) != 0;
        if dead {
            if let Some(n) = st.neutral_open.remove(&e.index()) {
                st.neutral_deaths[n] = Some(tick);
                let (heroes, at) = (st.heroes(), st.neutral_spawns[n].1);
                st.income.near(&heroes, at, income::SHARE_RANGE, income::NEUTRALS, tick);
            }
        }
    }

    /// The Urn on the map: a spawn, or -- straight after its carrier lost it -- a drop.
    fn on_urn(&self, ctx: &Context, d: DeltaHeader, e: &Entity) {
        if d != DeltaHeader::CREATE {
            return;
        }
        let (Some(x), Some(y)) = (
            coord(e, TROOPER_CELL_X, TROOPER_VEC_X),
            coord(e, TROOPER_CELL_Y, TROOPER_VEC_Y),
        ) else {
            return;
        };
        let mut st = self.0.borrow_mut();
        let tick = ctx.tick();
        let q = |v: f32| (v / POSITION_QUANT).round() as i32;
        // A pickup appearing the moment a carrier lost the Urn is it falling where they
        // did: the "delivery" recorded a moment ago was a drop.
        let dropped = st.urn_released.take().filter(|&(t, _)| tick - t <= 64);
        let urn = &mut st.events.urn;
        if dropped.is_some() && urn.kind.last() == Some(&"deliver") {
            let last = urn.kind.len() - 1;
            urn.kind[last] = "drop";
            urn.x[last] = q(x);
            urn.y[last] = q(y);
            return;
        }
        urn.t.push(tick);
        urn.kind.push("spawn");
        urn.player.push(-1);
        urn.x.push(q(x));
        urn.y.push(q(y));
    }

    /// The Urn in someone's hands: picked up when it appears on a hero, delivered (or
    /// dropped -- see `on_urn`) when it disappears.
    fn on_urn_carried(&self, ctx: &Context, d: DeltaHeader, e: &Entity) {
        if d != DeltaHeader::CREATE && d != DeltaHeader::DELETE {
            return;
        }
        let pawn = e
            .get_value::<u32>(&K_OWNER)
            .filter(|&h| is_ehandle_valid(h))
            .map(ehandle_to_index);
        let mut st = self.0.borrow_mut();
        let player = pawn.map_or(-1, |p| st.player_of_pawn(p));
        let [x, y] = pawn.map_or([0, 0], |p| st.pawn_at(p));
        let tick = ctx.tick();
        let kind = if d == DeltaHeader::CREATE { "pickup" } else { "deliver" };
        if d == DeltaHeader::DELETE {
            // A pickup that appeared a moment ago, while this hero still held the Urn, was
            // it falling where they died -- recorded as a spawn, since it came first.
            let urn = &mut st.events.urn;
            let n = urn.t.len();
            if n > 0 && urn.kind[n - 1] == "spawn" && tick - urn.t[n - 1] <= 64 {
                urn.kind[n - 1] = "drop";
                urn.player[n - 1] = player;
                return;
            }
            st.urn_released = Some((tick, player));
        }
        let urn = &mut st.events.urn;
        urn.t.push(tick);
        urn.kind.push(kind);
        urn.player.push(player);
        urn.x.push(x);
        urn.y.push(y);
    }

    /// A crate, statue or Sinner's Sacrifice appearing: a new life for its spot.
    fn on_breakable_spawn(&self, ctx: &Context, e: &Entity, kind: Breakable) {
        let (Some(x), Some(y)) = (
            coord(e, TROOPER_CELL_X, TROOPER_VEC_X),
            coord(e, TROOPER_CELL_Y, TROOPER_VEC_Y),
        ) else {
            return;
        };
        let mut st = self.0.borrow_mut();
        let list = st.events.breakables(kind);
        let n = list.t.len();
        list.t.push(ctx.tick());
        list.x.push((x / POSITION_QUANT).round() as i32);
        list.y.push((y / POSITION_QUANT).round() as i32);
        list.broken.push(-1);
        list.by.push(-1);
        st.breakable_open.insert(e.index(), (kind, n));
        st.sinner_hit.remove(&e.index());
    }

    /// A crate or Sinner's Sacrifice breaking, and who to credit. Debris for anything
    /// else -- lane troopers send it too, as they die -- is not read here.
    fn on_debris(&self, ctx: &Context, data: &[u8]) {
        let Some(index) = wire::bytes(data, 1)
            .and_then(|m| wire::varint(m, 1))
            .map(|h| ehandle_to_index(h as u32))
        else {
            return;
        };
        let mut st = self.0.borrow_mut();
        let tick = ctx.tick();
        st.trooper_died(index, tick);
        let Some((kind, n)) = st.breakable_open.remove(&index) else {
            return;
        };
        let sinner = kind == Breakable::Sinner;
        let window = (SINNER_CREDIT_SECONDS / st.interval()) as i32;
        let hitter = st
            .sinner_hit
            .remove(&index)
            .filter(|&(_, t)| sinner && tick - t <= window)
            .map(|(player, _)| player);
        let list = st.events.breakables(kind);
        let at = [list.x[n] as f32 * POSITION_QUANT, list.y[n] as f32 * POSITION_QUANT];
        let by = hitter.unwrap_or_else(|| st.nearest_player(at, CRATE_CREDIT_RANGE));
        let heroes = st.heroes();
        st.income.near(&heroes, at, income::BREAK_RANGE, income::BREAKABLES, tick);
        let list = st.events.breakables(kind);
        list.broken[n] = tick;
        list.by[n] = by;
    }

    /// Records who killed the Mid-Boss. Other bosses' deaths are already in their tracks.
    fn on_boss_killed(&self, ctx: &Context, data: &[u8]) {
        let mut st = self.0.borrow_mut();
        // Field 1 is the fallen objective's team, so its bounty went to the other one;
        // the Mid-Boss is neutral (4), and could have gone to either.
        let fallen = wire::varint(data, 1).unwrap_or(0) as u32;
        let paid: Vec<i32> = st
            .order
            .iter()
            .enumerate()
            .filter(|(_, index)| {
                st.rows.get(index).is_some_and(|row| match fallen {
                    2 | 3 => row.team == 5 - fallen,
                    _ => true,
                })
            })
            .map(|(p, _)| p as i32)
            .collect();
        for p in paid {
            st.income.evidence(p, income::BOSSES, ctx.tick());
        }
        if wire::varint(data, 4) != Some(BOSS_KIND_MID_BOSS) {
            return;
        }
        let player = wire::varint(data, 5)
            .map(|h| h as u32)
            .filter(|&h| is_ehandle_valid(h))
            .map_or(-1, |h| st.player_of_pawn(ehandle_to_index(h)));
        st.events.mid_boss_kills.t.push(ctx.tick());
        st.events.mid_boss_kills.player.push(player);
    }

    /// Records an item bought or sold. See the module note on events.
    fn on_item(&self, ctx: &Context, data: &[u8]) {
        let (Some(slot), Some(id), Some(change)) =
            (wire::varint(data, 1), wire::varint(data, 2), wire::varint(data, 3))
        else {
            return;
        };
        let sold = match change {
            CHANGE_BOUGHT => 0,
            CHANGE_SOLD => 1,
            _ => return,
        };
        let mut st = self.0.borrow_mut();
        // The buyer is named by player slot; their controller is the entity one past it.
        let controller = slot as i32 + 1;
        let Some(player) = st.order.iter().position(|&index| index == controller) else {
            return;
        };
        let items = &mut st.events.items;
        items.t.push(ctx.tick());
        items.player.push(player as i32);
        items.id.push(id as u32);
        items.sold.push(sold);
    }

    /// Notes that a hero fired.
    fn on_shot(&self, ctx: &Context, data: &[u8]) {
        let Some(pawn) = wire::varint(data, 5) else {
            return;
        };
        let mut st = self.0.borrow_mut();
        let player = st.player_of_pawn(pawn as i32);
        if player >= 0 {
            st.fired(player, ctx.tick());
        }
    }

    /// Records one hit, if a hero dealt or took it. See the module note on events.
    fn on_damage(&self, ctx: &Context, data: &[u8]) {
        let (Some(victim), Some(attacker)) = (wire::varint(data, 6), wire::varint(data, 7)) else {
            return;
        };
        let (victim, attacker) = (victim as i32, attacker as i32);
        let mut st = self.0.borrow_mut();

        // A projectile or summon hits in its own name; the inflictor is who made it.
        let mut from = st.player_of_pawn(attacker);
        if from < 0 {
            if let Some(inflictor) = wire::varint(data, 8) {
                from = st.player_of_pawn(inflictor as i32);
            }
        }
        let to = st.player_of_pawn(victim);
        if from >= 0 && st.neutral_open.contains_key(&victim) {
            st.income.evidence(from, income::NEUTRALS, ctx.tick());
        }
        if from >= 0
            && st.breakable_open.get(&victim).is_some_and(|&(kind, _)| kind == Breakable::Sinner)
        {
            let tick = ctx.tick();
            st.sinner_hit.insert(victim, (from, tick));
        }
        if from < 0 && to < 0 {
            return;
        }
        let kind_of = |player: i32, index: i32| {
            if player >= 0 {
                0
            } else {
                let kind = cause_of(ctx, index);
                KINDS.iter().position(|&k| k == kind).unwrap_or(KINDS.len() - 1) as i32
            }
        };
        let (from_kind, to_kind) = (kind_of(from, attacker), kind_of(to, victim));
        let amount = wire::varint(data, 1).unwrap_or(0) as i32;
        let source = match wire::varint(data, 14) {
            Some(id) if id != 0 => st.source_id(id as u32),
            _ => -1,
        };
        let tick = ctx.tick();

        if from >= 0 && wire::varint(data, 4) == Some(DAMAGE_KIND_BULLET) {
            st.fired(from, tick);
        }

        let d = &mut st.events.damage;
        let n = d.t.len();
        let same = n > 0
            && d.t[n - 1] == tick
            && d.from[n - 1] == from
            && d.from_kind[n - 1] == from_kind
            && d.to[n - 1] == to
            && d.to_kind[n - 1] == to_kind
            && d.source[n - 1] == source;
        if same {
            d.amount[n - 1] += amount;
            return;
        }
        d.t.push(tick);
        d.from.push(from);
        d.from_kind.push(from_kind);
        d.to.push(to);
        d.to_kind.push(to_kind);
        d.amount.push(amount);
        d.source.push(source);
    }

    /// Records one ability or item active being used.
    fn on_ability_cast(&self, ctx: &Context, data: &[u8]) {
        let (Some(handle), Some(name)) = (wire::varint(data, 1), wire::bytes(data, 3)) else {
            return;
        };
        let handle = handle as u32;
        if !is_ehandle_valid(handle) {
            return;
        }
        let pawn = ehandle_to_index(handle);
        let mut st = self.0.borrow_mut();
        let player = st.player_of_pawn(pawn);
        if player < 0 {
            return;
        }
        let ability = st.ability_id(name);
        let [x, y] = st.pawn_at(pawn);

        let casts = &mut st.events.casts;
        casts.t.push(ctx.tick());
        casts.player.push(player);
        casts.ability.push(ability);
        casts.x.push(x);
        casts.y.push(y);
    }
}

impl Collector {
    /// Tracks one hero's position, and notices when it jumped.
    ///
    /// The speed test runs here, at the demo's full rate, rather than over the sampled
    /// frames: a zip line is usually over within one sampled frame, so testing the kept
    /// positions would miss most of them and misjudge the rest.
    fn on_pawn(&self, ctx: &Context, e: &Entity) {
        let (Some(x), Some(y), Some(z)) = (
            coord(e, CELL_X, VEC_X),
            coord(e, CELL_Y, VEC_Y),
            coord(e, CELL_Z, VEC_Z),
        ) else {
            return;
        };
        let at = [x, y, z];
        let tick = ctx.tick();
        let mut st = self.0.borrow_mut();
        let interval = if st.tick_interval > 0.0 {
            st.tick_interval
        } else {
            FALLBACK_TICK_INTERVAL
        };
        let track = st.tracks.entry(e.index()).or_default();

        if track.seen {
            let elapsed = (tick - track.prev_tick).max(1) as f32 * interval;
            let moved = ((at[0] - track.prev[0]).powi(2)
                + (at[1] - track.prev[1]).powi(2)
                + (at[2] - track.prev[2]).powi(2))
            .sqrt();
            if moved / elapsed > TELEPORT_SPEED {
                track.jumped = true;
            }
        }

        track.prev = at;
        track.prev_tick = tick;
        track.at = at;
        // Independent reads, not folded into the position tuple above: haste hands back
        // an entity's whole cached state on every update, so these are current even on a
        // tick where only health -- not position -- actually changed.
        if let Some(hp) = e.get_value::<i64>(&K_HP) {
            track.hp_at = hp as i32;
        }
        if let Some(max_hp) = e.get_value::<i64>(&K_MAX_HP) {
            track.max_hp_at = max_hp as i32;
        }
        if let Some([_, yaw, _]) = e.get_value::<[f32; 3]>(&K_EYE_ANGLES) {
            track.yaw_at = yaw;
        }
        track.seen = true;
    }

    /// Opens, updates or closes one creep's life, on `d`'s say-so and on its own
    /// judgement.
    ///
    /// A life boundary can come from five different places, and this checks all of
    /// them, because on a real match no one of them alone was reliable:
    ///
    ///  - `DeltaHeader::CREATE`/`DELETE` are entity lifecycle events. The lane trooper's
    ///    whole pool is maybe 200 entity slots, reused thousands of times over a match,
    ///    and it is CREATE that marks a slot's reuse for a new wave -- DELETE never
    ///    fired for one across a full 35-minute match.
    ///  - `m_iHealth` reaching zero is checked first and is the earliest of the four: it
    ///    is the proximate cause of death, and every other signal either follows it on
    ///    the very same tick or, for a trooper that dies mid-lane with nobody nearby to
    ///    trigger a slot reuse, does not follow at all. A first version of this used
    ///    only `m_lifeState`; a dead trooper's marker stayed on the map for as long as
    ///    the corpse lingered before the engine recycled its slot, which on an unwatched
    ///    lane could be a long time. Checking health first closes the life the instant
    ///    there is nothing left to show.
    ///  - `m_lifeState` going non-zero is kept as a second signal, in case health is
    ///    ever absent from an update that a death is not.
    ///  - A position jump past [`CREEP_RESET_DIST`] catches a slot reused for a new wave
    ///    when even CREATE was missed.
    ///  - Going quiet for [`CREEP_STALE_SECONDS`] closes a life the sampling clock
    ///    notices on its own, in [`State::sample_creeps`], rather than here -- there is
    ///    no update to react to when nothing has arrived at all.
    ///
    /// Whichever notices first ends the life; a dead trooper is never drawn standing.
    fn on_creep(&self, ctx: &Context, d: DeltaHeader, e: &Entity) {
        let mut st = self.0.borrow_mut();

        if d == DeltaHeader::CREATE {
            finish_creep(&mut st, e.index());
        }

        let dead = e.get_value::<i64>(&K_HP).is_some_and(|hp| hp <= 0)
            || e.get_value::<u64>(&K_LIFE_STATE).unwrap_or(0) != 0;
        if dead {
            st.trooper_died(e.index(), ctx.tick());
            finish_creep(&mut st, e.index());
        } else if let (Some(x), Some(y)) = (
            coord(e, TROOPER_CELL_X, TROOPER_VEC_X),
            coord(e, TROOPER_CELL_Y, TROOPER_VEC_Y),
        ) {
            let reset = st.creep_tracks.get(&e.index()).is_some_and(|t| {
                t.seen && dist2(t.at, [x, y]) > CREEP_RESET_DIST * CREEP_RESET_DIST
            });
            if reset {
                finish_creep(&mut st, e.index());
            }

            let team = e.get_value::<u64>(&K_TEAM).unwrap_or(0) as u32;
            let track = st
                .creep_tracks
                .entry(e.index())
                .or_insert_with(|| CreepTrack { team, ..Default::default() });
            track.at = [x, y];
            track.seen = true;
            track.last_seen_tick = ctx.tick();
            if let Some(v) = e.get_value::<u64>(&K_TEAM) {
                track.team = v as u32;
            }
        }

        if d == DeltaHeader::DELETE {
            finish_creep(&mut st, e.index());
        }
    }

    /// Updates one objective's running state. No lifecycle handling the way a creep
    /// needs: an objective is discovered once and then simply accumulates until the
    /// match ends. The one transition is into destroyed, which is latched rather than
    /// read off health -- see the module note on objectives.
    ///
    /// `key` is the entity index for everything but the Mid-Boss, whose successive lives
    /// share one track; a `CREATE` is what starts a new life on it.
    fn on_objective(&self, d: DeltaHeader, e: &Entity, key: i32, kind: &'static str) {
        let mut st = self.0.borrow_mut();
        let track = st
            .objective_tracks
            .entry(key)
            .or_insert_with(|| ObjectiveTrack { kind, entity: e.index(), ..Default::default() });

        if d == DeltaHeader::CREATE {
            track.entity = e.index();
            track.destroyed = false;
        } else if e.index() != track.entity {
            // A straggler from a previous life on a shared track, such as a late
            // `DELETE`. It must not latch the current life as destroyed.
            return;
        }
        if track.destroyed {
            return;
        }
        if d == DeltaHeader::DELETE || e.get_value::<u64>(&K_LIFE_STATE).unwrap_or(0) != 0 {
            track.destroyed = true;
            track.hp_at = 0;
            return;
        }
        if let Some(v) = e.get_value::<u64>(&K_TEAM) {
            track.team = v as u32;
        }
        if track.at.is_none() {
            if let (Some(x), Some(y)) = (
                coord(e, TROOPER_CELL_X, TROOPER_VEC_X),
                coord(e, TROOPER_CELL_Y, TROOPER_VEC_Y),
            ) {
                track.at = Some([x, y]);
            }
        }
        if let Some(hp) = e.get_value::<i64>(&K_HP) {
            track.hp_at = hp as i32;
        }
        if let Some(max_hp) = e.get_value::<i64>(&K_MAX_HP) {
            track.max_hp_at = max_hp as i32;
        }
    }
}

impl Collector {
    /// Records one zipline node's owner whenever it changes. Everything else about a
    /// node is fixed, so it is read until it resolves and then left alone.
    fn on_zipline(&self, e: &Entity) {
        let mut st = self.0.borrow_mut();
        let frame = st.frames;
        let track = st.zipline_tracks.entry(e.index()).or_default();
        if let Some(v) = e.get_value::<i64>(&K_LANE) {
            track.lane = v;
        }
        if let Some(v) = e.get_value::<i64>(&K_NODE_INDEX) {
            track.node = v;
        }
        if track.at.is_none() {
            if let (Some(x), Some(y)) = (
                coord(e, TROOPER_CELL_X, TROOPER_VEC_X),
                coord(e, TROOPER_CELL_Y, TROOPER_VEC_Y),
            ) {
                track.at = Some([x, y]);
            }
        }
        // Anything but the two sides is "nobody": the middle of a rope starts out on team
        // 1, the engine's unassigned team, for its first few seconds before settling to 0.
        let team = match e.get_value::<u64>(&K_TEAM) {
            Some(t @ (2 | 3)) => t as u32,
            _ => 0,
        };
        if team != track.team {
            track.team = team;
            // Two changes inside one frame: only where it ended up is visible.
            if track.changes.last().is_some_and(|&(f, _)| f == frame) {
                track.changes.pop();
            }
            track.changes.push((frame, team));
        }
    }
}

/// Squared distance between two 2D points, for comparing against a squared threshold
/// without paying for a square root neither side of the comparison needs.
fn dist2(a: [f32; 2], b: [f32; 2]) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)
}

/// A player name as text. Source 2 strings are bytes and are not guaranteed to be UTF-8.
fn text(e: &Entity, key: u64) -> Option<String> {
    e.get_value::<Box<[u8]>>(&key)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// A `Read` backed by a JS callback, so the replay stays on the JS side.
///
/// The callback is handed an offset and a length and returns a `Uint8Array`. Only the
/// window it returns is ever copied into wasm memory. haste reads forward in small bites,
/// so a window of a megabyte turns into roughly one call per megabyte of demo.
struct JsStream {
    pos: u64,
    len: u64,
    read_chunk: js_sys::Function,
    window: Vec<u8>,
    window_start: u64,
}

/// How much to pull per call into JS. Large enough that the call overhead disappears
/// against the copy, small enough to stay invisible next to the parser's own footprint.
const WINDOW: usize = 1 << 20;

impl Read for JsStream {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.pos >= self.len {
            return Ok(0);
        }
        let past_window =
            self.pos < self.window_start || self.pos >= self.window_start + self.window.len() as u64;
        if past_window {
            let chunk = self
                .read_chunk
                .call2(
                    &JsValue::NULL,
                    &JsValue::from_f64(self.pos as f64),
                    &JsValue::from_f64(WINDOW as f64),
                )
                .map_err(|_| std::io::Error::other("reading the demo failed"))?;
            self.window = js_sys::Uint8Array::new(&chunk).to_vec();
            self.window_start = self.pos;
            if self.window.is_empty() {
                return Ok(0);
            }
        }
        let offset = (self.pos - self.window_start) as usize;
        let n = out.len().min(self.window.len() - offset);
        out[..n].copy_from_slice(&self.window[offset..offset + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for JsStream {
    fn seek(&mut self, from: SeekFrom) -> std::io::Result<u64> {
        let pos = match from {
            SeekFrom::Start(n) => n as i64,
            SeekFrom::End(n) => self.len as i64 + n,
            SeekFrom::Current(n) => self.pos as i64 + n,
        };
        if pos < 0 {
            return Err(std::io::Error::other("seek before start of demo"));
        }
        self.pos = pos as u64;
        Ok(self.pos)
    }
}

/// Parses a replay into a scoreboard timeline, as JSON.
///
/// `len` is the file's size in bytes and `read_chunk` is `(offset, length) -> Uint8Array`.
/// The callback is called synchronously, which is why this belongs in a worker: in the
/// browser only `FileReaderSync` can serve it, and it only exists off the main thread.
///
/// Errors come back as a thrown JS string rather than a result object, so the worker can
/// let them propagate.
#[wasm_bindgen]
pub fn parse_scoreboard(len: f64, read_chunk: js_sys::Function) -> Result<String, JsValue> {
    let stream = JsStream {
        pos: 0,
        len: len as u64,
        read_chunk,
        window: Vec::new(),
        // No window loaded yet: any position is outside it.
        window_start: u64::MAX,
    };

    let demo = DemoFile::start_reading(stream)
        .map_err(|e| JsValue::from_str(&format!("not a Source 2 demo: {e}")))?;
    let collector = Collector::default();
    let state = collector.0.clone();
    let mut parser = Parser::from_stream_with_visitor(demo, collector)
        .map_err(|e| JsValue::from_str(&format!("could not read the demo header: {e}")))?;
    parser
        .run_to_end()
        .map_err(|e| JsValue::from_str(&format!("the demo ended unexpectedly: {e}")))?;

    let mut st = state.borrow_mut();
    // The closing standings are what a scoreboard is usually asked for, and the last
    // periodic frame can sit just short of them.
    let last_tick = st.last_tick;
    st.sample(last_tick);

    let players: Vec<Player> = st
        .order
        .iter()
        .map(|index| {
            let row = st.rows.get(index).cloned().unwrap_or_default();
            Player {
                slot: row.slot,
                // Through JSON as a string: a 64-bit id does not survive an f64.
                steam_id: row.steam_id.to_string(),
                name: row.name,
                hero_id: row.hero_id,
                team: row.team,
                rank: row.rank,
            }
        })
        .collect();

    // Positions, reordered from pawn entity index onto the player order above, so a
    // caller can use one index for both streams.
    let position_frames = st.position_frames;
    let pawns: Vec<i32> = st
        .order
        .iter()
        .map(|index| st.rows.get(index).map(|r| r.pawn).unwrap_or(-1))
        .collect();
    let mut positions = Positions {
        hz: POSITION_HZ,
        quant: POSITION_QUANT,
        frames: position_frames,
        ..Default::default()
    };
    for pawn in pawns {
        // A player whose hero was never resolved still gets arrays, so every stream has
        // one entry per player and indices stay aligned.
        let take = |pick: fn(&Track) -> &Vec<i32>| {
            let mut column = st
                .tracks
                .get(&pawn)
                .map(|t| pick(t).clone())
                .unwrap_or_default();
            column.resize(position_frames, 0);
            column
        };
        positions.x.push(take(|t| &t.x));
        positions.y.push(take(|t| &t.y));
        positions.z.push(take(|t| &t.z));
        positions.cut.push(take(|t| &t.cut));
        positions.hp.push(take(|t| &t.hp));
        positions.max_hp.push(take(|t| &t.max_hp));
        positions.yaw.push(take(|t| &t.yaw));
    }

    // Whatever creeps the match ended with never got a DELETE, or a further CREATE, to
    // close their life out -- the demo just stops -- so they are flushed here the same
    // way the last scoreboard frame above is.
    let open: Vec<i32> = st.creep_tracks.keys().copied().collect();
    for index in open {
        finish_creep(&mut st, index);
    }

    // No flush needed here the way creeps and the scoreboard need one: `sample()`
    // already pushed one hp/maxHp entry per second for every objective, for as long as
    // the match ran, whether or not it was destroyed along the way.
    let objectives = Objectives {
        quant: POSITION_QUANT,
        list: st
            .objective_order
            .iter()
            .filter_map(|index| {
                let track = st.objective_tracks.get(index)?;
                let at = track.at?;
                Some(Objective {
                    kind: track.kind,
                    team: track.team,
                    x: (at[0] / POSITION_QUANT).round() as i32,
                    y: (at[1] / POSITION_QUANT).round() as i32,
                    hp: track.hp.clone(),
                    max_hp: track.max_hp.clone(),
                })
            })
            .collect(),
    };

    // Nodes grouped into lanes and put in rope order, each change re-addressed from the
    // node's entity to its place along the rope.
    let mut by_lane: BTreeMap<i64, Vec<&ZiplineTrack>> = BTreeMap::new();
    for track in st.zipline_tracks.values() {
        if track.at.is_some() {
            by_lane.entry(track.lane).or_default().push(track);
        }
    }
    let lanes = Lanes {
        quant: POSITION_QUANT,
        list: by_lane
            .into_iter()
            .map(|(lane, mut nodes)| {
                nodes.sort_by_key(|n| n.node);
                let mut changes: Vec<[i32; 3]> = nodes
                    .iter()
                    .enumerate()
                    .flat_map(|(i, n)| {
                        n.changes.iter().map(move |&(f, t)| [f as i32, i as i32, t as i32])
                    })
                    .collect();
                changes.sort();
                let quant = |v: f32| (v / POSITION_QUANT).round() as i32;
                Lane {
                    lane,
                    x: nodes.iter().map(|n| quant(n.at.unwrap_or_default()[0])).collect(),
                    y: nodes.iter().map(|n| quant(n.at.unwrap_or_default()[1])).collect(),
                    changes,
                }
            })
            .collect(),
    };

    // Event ticks re-based onto the streams' shared clock start, now that it is known.
    let start = st.start_tick.unwrap_or(0);
    let mut events = std::mem::take(&mut st.events);
    for t in events
        .kills
        .t
        .iter_mut()
        .chain(events.casts.t.iter_mut())
        .chain(events.damage.t.iter_mut())
        .chain(events.items.t.iter_mut())
        .chain(events.firing.iter_mut().flatten())
    {
        *t -= start;
    }
    for (n, &(tick, at)) in st.neutral_spawns.iter().enumerate() {
        let neutrals = &mut events.neutrals;
        neutrals.t.push(tick - start);
        neutrals.x.push((at[0] / POSITION_QUANT).round() as i32);
        neutrals.y.push((at[1] / POSITION_QUANT).round() as i32);
        neutrals.died.push(st.neutral_deaths[n].map_or(-1, |t| t - start));
    }
    for t in events
        .urn
        .t
        .iter_mut()
        .chain(events.mid_boss_kills.t.iter_mut())
        .chain(events.crates.t.iter_mut())
        .chain(events.sinners.t.iter_mut())
        .chain(events.statues.t.iter_mut())
    {
        *t -= start;
    }
    for t in events
        .crates
        .broken
        .iter_mut()
        .chain(events.sinners.broken.iter_mut())
        .chain(events.statues.broken.iter_mut())
    {
        if *t >= 0 {
            *t -= start;
        }
    }

    // One entry per player even for someone who never fired, so indices line up.
    events.firing.resize(st.order.len(), Vec::new());
    events.kinds = KINDS.to_vec();
    events.hz = 1.0
        / if st.tick_interval > 0.0 {
            st.tick_interval
        } else {
            FALLBACK_TICK_INTERVAL
        };
    events.quant = POSITION_QUANT;

    let clock_start = st.game_start.map_or(0.0, |t| (t - start) as f32 * st.interval());
    let clock = st
        .clock
        .iter()
        .map(|&(t, game, paused)| ClockAnchor {
            t: (t - start) as f32 * st.interval(),
            game,
            paused,
        })
        .collect();
    let frames = st.frames;
    let slots: Vec<u32> =
        st.order.iter().map(|i| st.rows.get(i).map_or(u32::MAX, |r| r.slot)).collect();
    let (tps, interval) = (st.ticks_per_sample.max(1), st.interval());
    let income = income::build(
        &st.income,
        &income::Context {
            slots: &slots,
            frames,
            frame_of: &|t| (((t - start).max(0) + tps - 1) / tps) as usize,
            seconds_of: &|t| (t - start) as f32 * interval,
            tick_of_game: &|g| st.tick_of_game(g),
            game_start: st.game_start,
            ticks_per_second: 1.0 / interval,
        },
    );
    let timeline = Timeline {
        clock_start,
        clock,
        sample_seconds: SAMPLE_SECONDS,
        duration: ((frames.saturating_sub(1)) as f32 * SAMPLE_SECONDS) as i32,
        frames,
        players,
        series: std::mem::take(&mut st.series),
        positions,
        creeps: Creeps {
            hz: CREEP_HZ,
            quant: POSITION_QUANT,
            lives: std::mem::take(&mut st.creep_lives),
        },
        objectives,
        lanes,
        events,
        income,
    };
    serde_json::to_string(&timeline).map_err(|e| JsValue::from_str(&e.to_string()))
}
