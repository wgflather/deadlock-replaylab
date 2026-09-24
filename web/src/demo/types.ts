/**
 * The shape the wasm parser emits. Mirrors the `Serialize` structs in
 * demo-parser/src/lib.rs; the two have to be changed together.
 *
 * Laid out by column rather than by frame: identity is stated once per player, and each
 * statistic is one array of numbers per player over match time. A frame is an index into
 * those arrays. That is what makes one-second sampling affordable -- the same timeline as
 * a list of per-frame objects costs many times more to send and to hold.
 */

/** Who a player is. Fixed for the match. */
export type Player = {
  /** The lobby slot, stable for the whole match. */
  slot: number
  /** A 64-bit id, carried as a string because it does not survive an f64. */
  steamId: string
  name: string
  heroId: number
  /** 2 is the Amber Hand, 3 the Sapphire Flame. */
  team: number
  /** Ranked badge at match start, tier * 10 + subtier; 0 when unranked. */
  rank: number
}

/** Each entry is indexed by player, then by frame. */
export type Series = {
  kills: number[][]
  deaths: number[][]
  assists: number[][]
  netWorth: number[][]
  heroDamage: number[][]
  objectiveDamage: number[][]
  healing: number[][]
  lastHits: number[][]
  denies: number[][]
  level: number[][]
  /** 0 or 1. */
  alive: number[][]
}

/**
 * Where everyone was, eight times a second.
 *
 * Coordinates are whole multiples of `quant` world units -- multiply to get world space.
 * Sampled far faster than the scoreboard because position is the only thing in a match
 * that moves continuously.
 */
export type Positions = {
  /** Position frames per second. */
  hz: number
  /** World units per stored step. */
  quant: number
  /** Number of position frames; every array below has this length. */
  frames: number
  x: number[][]
  y: number[][]
  z: number[][]
  /**
   * 1 where the player jumped into this frame -- a zip line, teleport or respawn.
   * Interpolating across one of these draws a line through terrain nobody walked, so a
   * viewer should snap instead.
   */
  cut: number[][]
  /**
   * Current health. Can run past `maxHp` -- a temporary bonus-health source adds
   * straight to it without raising the cap, and on one real match this held for close to
   * half of all sampled frames -- so a ratio built from these has to clamp to 1 rather
   * than trust the two numbers to stay in the order their names suggest.
   */
  hp: number[][]
  maxHp: number[][]
  /**
   * Where the player is looking, in whole degrees: 0 is east (world +x), 90 north,
   * counter-clockwise -- the game's own convention.
   */
  yaw: number[][]
}

/**
 * One creep's whole life, start to death or the end of the match.
 *
 * Unlike a player, not a fixed track padded to the match length: a match runs a couple
 * of thousand of these, each alive for well under a minute on average, so a dense array
 * padded to the whole match would be almost entirely padding. `x`/`y` begin at
 * `startFrame` on the creep clock (`Creeps.hz`, its own and slower than a player's) and
 * run one entry per frame for as long as it existed.
 */
export type Creep = {
  /** 2 is the Amber Hand, 3 the Sapphire Flame. */
  team: number
  startFrame: number
  x: number[]
  y: number[]
}

export type Creeps = {
  /** Creep frames per second -- its own clock, slower than a player's. */
  hz: number
  /** World units per stored step. Shares `Positions.quant`. */
  quant: number
  lives: Creep[]
}

/**
 * Lane Guardians and Walkers, the Base Guardians and Shrines inside each base, each
 * team's Patron, and the neutral Mid-Boss at the centre of the map.
 */
export type ObjectiveKind = 'guardian' | 'walker' | 'baseGuardian' | 'shrine' | 'patron' | 'midBoss'

/**
 * One objective's whole match: a fixed position and its health over time.
 *
 * Unlike a creep, there is a small fixed number of these, each tracked for the whole
 * match, so `hp`/`maxHp` are dense arrays indexed by the scoreboard's own frame number
 * (`Timeline.frames`), not a separate clock the way positions and creeps have one --
 * nothing about a structure's health changes fast enough to need either. A destroyed
 * objective is pinned at zero from its death to the end of the match; there is no
 * separate "destroyed" flag to read past `hp`. `maxHp` is not fixed: Walkers, Shrines
 * and Patrons all gain some mid-match.
 *
 * The Mid-Boss is the exception to "one life": it respawns, and all its lives share
 * this one entry, so `hp` is zero before its first spawn and between each kill and the
 * next spawn, and comes back above zero with each new life.
 */
export type Objective = {
  kind: ObjectiveKind
  /** 2 is the Amber Hand, 3 the Sapphire Flame, 4 neutral (the Mid-Boss). */
  team: number
  /** A single point, not an array: this kind of objective never moves. */
  x: number
  y: number
  hp: number[]
  maxHp: number[]
}

export type Objectives = {
  /** World units per stored position step. Shares `Positions.quant`. */
  quant: number
  list: Objective[]
}

/**
 * One lane's zipline: its nodes in rope order, and who could ride each part of it when.
 *
 * Ownership is the server's own -- each node of the rope is an entity whose team is
 * whoever can use it -- not something inferred here from where troopers stand. It is
 * a list of changes rather than a per-frame array, since a node changes hands only a
 * dozen or so times a match.
 */
export type Lane = {
  /** 1 is the west lane (York), 4 the middle (Broadway), 6 the east (Greenwich). */
  lane: number
  x: number[]
  y: number[]
  /**
   * `[frame, node, team]` in frame order, on the scoreboard's clock: from `frame` on,
   * node `node` belongs to `team` -- 2 Amber, 3 Sapphire, 0 nobody. A node is nobody's
   * until its first change.
   */
  changes: [number, number, number][]
}

export type Lanes = {
  /** World units per stored position step. Shares `Positions.quant`. */
  quant: number
  list: Lane[]
}

/** What landed a killing blow -- not always the killer, who is whoever was credited. */
export type KillCause = 'hero' | 'trooper' | 'neutral' | ObjectiveKind | 'other'

/**
 * Every hero death, one entry per death across all the arrays, in time order. Player
 * fields index `Timeline.players`; -1 means no player.
 */
export type Kills = {
  /** Ticks into the match -- divide by `Events.hz` for seconds. */
  t: number[]
  victim: number[]
  /** The hero credited with the kill, or -1 when nobody was. */
  killer: number[]
  cause: KillCause[]
  assisters: number[][]
  /** Where the victim died, in `Events.quant` steps. */
  x: number[]
  y: number[]
}

/** Every ability and item active used, one entry per cast, in time order. */
export type Casts = {
  t: number[]
  player: number[]
  /** Index into `Events.abilities`. */
  ability: number[]
  x: number[]
  y: number[]
}

/** What can deal or take damage, as `Events.kinds` lists them. "hero" is always first. */
export type DamageKind = 'hero' | 'trooper' | 'neutral' | ObjectiveKind | 'other'

/**
 * Every hit a hero dealt or took, in time order. Hits with the same attacker, victim and
 * source on one tick -- a shotgun's pellets -- are one entry.
 *
 * Summed per hero, hits on enemy heroes come to within a few percent of the scoreboard's
 * hero damage, not exactly it: a breakdown to read beside the scoreboard's totals.
 */
export type Damage = {
  t: number[]
  /** Index into `Timeline.players`, or -1 for something not a hero. */
  from: number[]
  /** Index into `Events.kinds`; 0 (hero) wherever `from` is a player. */
  fromKind: number[]
  to: number[]
  toKind: number[]
  amount: number[]
  /** Index into `Events.sources`, or -1 for a hit that named none. */
  source: number[]
}

/**
 * Every item bought or sold, in time order. An upgrade arrives as the new item bought
 * and its component sold on the same tick.
 */
export type Items = {
  t: number[]
  /** Index into `Timeline.players`. */
  player: number[]
  /** deadlock-api id -- see ../abilities for names and icons. */
  id: number[]
  /** 1 for a sale (or a component consumed by an upgrade), 0 for a purchase. */
  sold: number[]
}

/**
 * Every neutral creep that spawned, in time order. Which camp each belongs to is worked
 * out against the minimap's named camps -- see ./mapState. A death is -1 where it was
 * never seen: creeps far from every player are not sent at all.
 */
export type Neutrals = {
  /** Ticks. */
  t: number[]
  /** In `Events.quant` steps. */
  x: number[]
  y: number[]
  /** Ticks, or -1. */
  died: number[]
}

/**
 * Every crate, or every Sinner's Sacrifice, that stood: one entry per life, in spawn
 * order. A spot's lives follow one another -- each respawn comes after the last broke.
 */
export type Breakables = {
  /** Ticks. */
  t: number[]
  x: number[]
  y: number[]
  /** Ticks, or -1 if still standing at the end. */
  broken: number[]
  /** Index into `Timeline.players`, or -1 when nobody could be credited: a crate goes
   * to the nearest hero within 600 units, a Sinner's Sacrifice to the last hero to hit
   * it. */
  by: number[]
}

/** Everything that happened to the Urn, in time order. */
export type UrnEvents = {
  t: number[]
  kind: ('spawn' | 'pickup' | 'drop' | 'deliver')[]
  /** Index into `Timeline.players`; -1 for a spawn. */
  player: number[]
  x: number[]
  y: number[]
}

/**
 * Moments rather than state, kept at full tick precision rather than sampled: a death
 * rounded to the nearest second would land on the wrong side of the frame that shows it.
 */
export type Events = {
  /** Ticks per second. */
  hz: number
  /** World units per stored position step. Shares `Positions.quant`. */
  quant: number
  /** Internal ability names such as `synth_barrage`; item actives are `upgrade_*`. */
  abilities: string[]
  kills: Kills
  casts: Casts
  /**
   * Per player, when they were firing, as `[start, end, start, end, ...]` in ticks.
   * Shots close together are one burst; a lone shot has its start equal to its end.
   */
  firing: number[][]
  damage: Damage
  kinds: DamageKind[]
  /** deadlock-api ids of what damage came from -- see ../abilities for names. */
  sources: number[]
  items: Items
  neutrals: Neutrals
  urn: UrnEvents
  /** Each time the Mid-Boss fell, and the player credited (-1 for none). */
  midBossKills: { t: number[]; player: number[] }
  crates: Breakables
  sinners: Breakables
  /** Golden Statues: breakable props like crates, on the same loop. */
  statues: Breakables
}

/** A point the in-game clock was set at; between anchors it runs, unless paused. */
export type ClockAnchor = {
  /** Seconds into the recording. */
  t: number
  /** The in-game clock's reading then, in seconds. */
  game: number
  paused: boolean
}

/**
 * Souls each player earned, by source. Fitted to the game's own split at each checkpoint
 * and estimated between them -- see `income.rs` in the parser for how, and how well.
 */
export type Income = {
  /** False when the replay has no post-match summary: nothing was fitted to the game's
   * own split, and every value is an estimate. */
  calibrated: boolean
  /** What each index of `souls` holds. */
  sources: IncomeSource[]
  /** Seconds into the recording where the split is the game's own. */
  checkpoints: number[]
  /** Per player, per source: souls earned so far, one value per frame. */
  souls: number[][][]
}

export type IncomeSource =
  'kills' | 'assists' | 'lane' | 'neutrals' | 'objectives' | 'breakables' | 'teamBonus' | 'other'

export type Timeline = {
  /**
   * Seconds from the start of the recording -- where every time here is measured from --
   * to 0:00 on the in-game clock. A replay starts during the pre-game countdown, so this
   * is about thirty. Show times with `gameClock` rather than as they are: it also takes
   * pauses out, which this does not.
   */
  clockStart: number
  /** The in-game clock, pauses included. */
  clock: ClockAnchor[]
  /** Seconds of match time per frame. */
  sampleSeconds: number
  /** Match length in seconds. */
  duration: number
  /** Number of frames; every series array has this length. */
  frames: number
  players: Player[]
  series: Series
  positions: Positions
  creeps: Creeps
  objectives: Objectives
  lanes: Lanes
  events: Events
  income: Income
}

/** A player's place on the map at one moment, in world units, with their health. */
export type Spot = {
  x: number
  y: number
  z: number
  /** 0 to 1, clamped -- see the note on `Positions.hp` for why a ratio needs clamping. */
  hpFraction: number
  /** Whether they were standing at this moment, read off health rather than a separate
   * flag: the position stream has no death event of its own, and health hitting zero is
   * the same fact by another name. */
  alive: boolean
  /** Where they are looking, in degrees: 0 east, 90 north, counter-clockwise. */
  yaw: number
}

/**
 * Blends two angles in degrees the short way round: from 350 to 10 is a 20-degree turn
 * through 0, not 340 degrees back the other way.
 */
export function lerpAngle(from: number, to: number, t: number) {
  const turn = ((((to - from) % 360) + 540) % 360) - 180
  return (((from + turn * t) % 360) + 360) % 360
}

/**
 * Everyone's position and health `seconds` into the match, interpolated between stored
 * frames.
 *
 * Interpolation is what lets eight frames a second look continuous, but it is skipped
 * into any frame marked `cut`: the player did not travel that line, and drawing it would
 * send them through walls -- or, for health, through a respawn's instant reset. There the
 * later values are used outright, so both read as the jump they were.
 */
export function spotsAt(timeline: Timeline, seconds: number): Spot[] {
  const p = timeline.positions
  const exact = seconds * p.hz
  const i = Math.max(0, Math.min(Math.floor(exact), p.frames - 1))
  const next = Math.min(i + 1, p.frames - 1)
  const frac = exact - i

  return timeline.players.map((_, n) => {
    // A jump is snapped to, not travelled through.
    const blend = p.cut[n][next] === 1 ? 1 : frac
    const lerp = (column: number[]) => column[i] + (column[next] - column[i]) * blend

    const hp = lerp(p.hp[n])
    const maxHp = lerp(p.maxHp[n])
    return {
      x: lerp(p.x[n]) * p.quant,
      y: lerp(p.y[n]) * p.quant,
      z: lerp(p.z[n]) * p.quant,
      hpFraction: maxHp > 0 ? Math.min(hp / maxHp, 1) : 0,
      alive: hp > 0,
      yaw: lerpAngle(p.yaw[n][i], p.yaw[n][next], blend),
    }
  })
}

/** One creep's place on the map at one moment. */
export type CreepSpot = {
  x: number
  y: number
  team: number
  /**
   * This life's own position in `Creeps.lives`, stable for as long as it exists.
   * `creepsAt` returns a different subset of lives on every call as creeps die and
   * spawn, so a React key built from the *output* array's index would be reused across
   * renders for whichever unrelated life happens to land on the same index next -- the
   * node would be patched in place rather than unmounted, which is exactly the kind of
   * bug that can look like a dead creep's marker lingering. This index is the one thing
   * that does not shift, so it is what a caller should key on instead.
   */
  id: number
}

/**
 * Every creep alive `seconds` into the match, interpolated the same way a player's
 * position is.
 *
 * A linear scan of every life the match ever had, not an index kept current as playback
 * moves: there are a couple of thousand of them, and a range check per life is cheap
 * enough that keeping a separate structure in sync would cost more than it saves.
 *
 * No `cut` flag the way a player's stream has one: creeps do not zip-line, and a life
 * boundary already ends wherever the parser saw a real reset, so there is nothing left
 * for one frame within a life to jump across.
 */
export function creepsAt(timeline: Timeline, seconds: number): CreepSpot[] {
  const c = timeline.creeps
  const exact = seconds * c.hz
  const out: CreepSpot[] = []

  for (let id = 0; id < c.lives.length; id++) {
    const life = c.lives[id]
    const local = exact - life.startFrame
    const last = life.x.length - 1
    if (local < 0 || local > last) continue

    const i = Math.min(Math.floor(local), last)
    const next = Math.min(i + 1, last)
    const frac = local - i
    const lerp = (column: number[]) => column[i] + (column[next] - column[i]) * frac

    out.push({
      x: lerp(life.x) * c.quant,
      y: lerp(life.y) * c.quant,
      team: life.team,
      id,
    })
  }
  return out
}

/** One objective's place on the map at one moment, in world units, with its health. */
export type ObjectiveSpot = {
  kind: ObjectiveKind
  team: number
  x: number
  y: number
  /** 0 to 1. Unlike a player's, this never runs past full -- a structure's health has
   * no bonus-health mechanic to push it over -- so nothing here needs to clamp it. */
  hpFraction: number
  destroyed: boolean
  /** The lane it defends -- see `laneOf` -- or null for a Shrine, Patron or Mid-Boss. */
  lane: number | null
  /** Whether it lost health within the last `DAMAGE_LINGER_SECONDS`: under attack now,
   * or was only a moment ago. */
  recentlyDamaged: boolean
}

/**
 * How long something reads as "being damaged" after its health last went down. Long
 * enough that a bar shown for a fight does not flicker off between two volleys; short
 * enough that it is gone soon after the fight moves on.
 */
const DAMAGE_LINGER_SECONDS = 5

/** Whether `hp` went down at any frame after `frame - window` up to `frame`. */
function droppedWithin(hp: number[], frame: number, window: number) {
  for (let k = frame; k > frame - window && k > 0; k--) {
    if (hp[k] < hp[k - 1]) return true
  }
  return false
}

/** The kinds that stand on a lane rather than in a base or the middle of the map. */
const ON_A_LANE: ReadonlySet<ObjectiveKind> = new Set(['guardian', 'walker', 'baseGuardian'])

/**
 * The lane a structure at (`x`, `y`) defends: the lane of its nearest zipline node.
 *
 * The demo does say which structure guards which stretch of rope (a node's
 * `m_hGuardingBosses`), but only for the one currently in front: a structure never
 * reached in a match is never named. Distance names all of them, and is unambiguous --
 * measured, every lane structure is within 350 units of a node on its own lane and over
 * 1600 from any other lane's.
 */
function laneOf(timeline: Timeline, x: number, y: number): number | null {
  const quant = timeline.lanes.quant
  let best: number | null = null
  let bestDistance = Infinity
  for (const lane of timeline.lanes.list) {
    for (let i = 0; i < lane.x.length; i++) {
      const distance = Math.hypot(lane.x[i] * quant - x, lane.y[i] * quant - y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = lane.lane
      }
    }
  }
  return best
}

/**
 * Every objective's state `seconds` into the match, interpolated between the
 * scoreboard's own one-second samples.
 *
 * Position needs no interpolation -- an objective does not move -- only health does,
 * for the same reason a player's health is interpolated: a viewer scrubbing should see
 * a structure's health draining smoothly through a siege, not stepping once a second.
 */
export function objectivesAt(timeline: Timeline, seconds: number): ObjectiveSpot[] {
  const exact = seconds / timeline.sampleSeconds
  const last = timeline.frames - 1
  const i = Math.max(0, Math.min(Math.floor(exact), last))
  const next = Math.min(i + 1, last)
  const frac = exact - i

  return timeline.objectives.list.map((o) => {
    const lerp = (column: number[]) => column[i] + (column[next] - column[i]) * frac
    const hp = lerp(o.hp)
    const maxHp = lerp(o.maxHp)
    const x = o.x * timeline.objectives.quant
    const y = o.y * timeline.objectives.quant
    return {
      kind: o.kind,
      team: o.team,
      x,
      y,
      hpFraction: maxHp > 0 ? hp / maxHp : 0,
      destroyed: hp <= 0,
      lane: ON_A_LANE.has(o.kind) ? laneOf(timeline, x, y) : null,
      // `next`, not `i`: while interpolating toward a lower frame the drop is already
      // on screen, so the bar should be too.
      recentlyDamaged: droppedWithin(
        o.hp,
        next,
        Math.ceil(DAMAGE_LINGER_SECONDS / timeline.sampleSeconds) + 1,
      ),
    }
  })
}

/** Base Guardians closer than this, in world units, stand guard as one pair. Measured:
 * a pair is 350 to 450 apart, and the nearest guardian of another pair over 1800. */
const BASE_GUARDIAN_PAIR = 800

/**
 * Folds each pair of Base Guardians into one spot, the way the game's minimap shows a
 * lane's pair as a single icon: at their midpoint, with their health averaged -- both
 * have the same maximum, so that is their combined health -- and destroyed only once
 * both are. Every other objective passes through untouched.
 */
export function pairBaseGuardians(spots: ObjectiveSpot[]): ObjectiveSpot[] {
  const out: ObjectiveSpot[] = []
  const taken = new Set<number>()
  spots.forEach((spot, i) => {
    if (taken.has(i)) return
    if (spot.kind !== 'baseGuardian') {
      out.push(spot)
      return
    }
    const j = spots.findIndex(
      (other, k) =>
        k > i &&
        !taken.has(k) &&
        other.kind === 'baseGuardian' &&
        other.team === spot.team &&
        Math.hypot(other.x - spot.x, other.y - spot.y) < BASE_GUARDIAN_PAIR,
    )
    if (j < 0) {
      out.push(spot)
      return
    }
    taken.add(j)
    const mate = spots[j]
    out.push({
      ...spot,
      x: (spot.x + mate.x) / 2,
      y: (spot.y + mate.y) / 2,
      hpFraction: (spot.hpFraction + mate.hpFraction) / 2,
      destroyed: spot.destroyed && mate.destroyed,
    })
  })
  return out
}

/** One lane at one moment: its nodes in world units, and each node's owner. */
export type LaneSpot = {
  lane: number
  x: number[]
  y: number[]
  /** Per node: 2 Amber, 3 Sapphire, 0 nobody. */
  owners: number[]
}

/**
 * Every lane's ownership `seconds` into the match. Not interpolated: a node belongs to
 * one side or the other, with nothing in between to blend.
 *
 * Replays the changes from the start on every call. That is a few hundred steps per
 * lane, which is nothing next to drawing the frame it is for, and it keeps scrubbing
 * backwards exactly as correct as playing forwards.
 */
export function lanesAt(timeline: Timeline, seconds: number): LaneSpot[] {
  const frame = Math.floor(seconds / timeline.sampleSeconds)
  const quant = timeline.lanes.quant
  return timeline.lanes.list.map((lane) => {
    const owners = new Array<number>(lane.x.length).fill(0)
    for (const [f, node, team] of lane.changes) {
      if (f > frame) break
      owners[node] = team
    }
    return {
      lane: lane.lane,
      x: lane.x.map((v) => v * quant),
      y: lane.y.map((v) => v * quant),
      owners,
    }
  })
}

/** The map's bounds across the whole match, in world units. */
export function extent(timeline: Timeline) {
  const p = timeline.positions
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const column of p.x) {
    for (const v of column) {
      if (v < minX) minX = v
      if (v > maxX) maxX = v
    }
  }
  for (const column of p.y) {
    for (const v of column) {
      if (v < minY) minY = v
      if (v > maxY) maxY = v
    }
  }
  return {
    minX: minX * p.quant,
    maxX: maxX * p.quant,
    minY: minY * p.quant,
    maxY: maxY * p.quant,
  }
}

/** One player's scoreboard row at one frame, assembled from the columns. */
export type Row = Player & {
  kills: number
  deaths: number
  assists: number
  netWorth: number
  heroDamage: number
  objectiveDamage: number
  healing: number
  lastHits: number
  denies: number
  level: number
  alive: boolean
}

/**
 * The scoreboard at one frame.
 *
 * Built on demand rather than stored: twelve rows of eleven lookups is far cheaper than
 * keeping every frame's rows as objects, which is the cost the columnar layout exists to
 * avoid in the first place.
 */
export function rowsAt(timeline: Timeline, frame: number): Row[] {
  const f = Math.max(0, Math.min(frame, timeline.frames - 1))
  const s = timeline.series
  return timeline.players.map((player, i) => ({
    ...player,
    kills: s.kills[i][f],
    deaths: s.deaths[i][f],
    assists: s.assists[i][f],
    netWorth: s.netWorth[i][f],
    heroDamage: s.heroDamage[i][f],
    objectiveDamage: s.objectiveDamage[i][f],
    healing: s.healing[i][f],
    lastHits: s.lastHits[i][f],
    denies: s.denies[i][f],
    level: s.level[i][f],
    alive: s.alive[i][f] === 1,
  }))
}

/** The two factions, by the team number the replay uses. */
export const AMBER = 2
export const SAPPHIRE = 3

/** Messages the worker sends back, in the order a successful parse produces them. */
export type WorkerMessage =
  | { kind: 'ready' }
  | { kind: 'done'; timeline: Timeline; elapsedMs: number }
  | { kind: 'error'; message: string }
