import type { ScheduleRow } from '../demo/mapFlow'
import type { Breakables, Timeline } from '../demo/types'
import current from './data/current.json'
import legacy from './data/legacy.json'

/**
 * The map's clock without a replay: the static layout of each map (generated from a
 * reference replay by scripts/gen-map-data.ts) played out against the timers that run
 * the same in every match, as a stand-in match the viewer's own map and panels can show.
 *
 * Only what runs on the clock is played out -- first spawns, the powerup drops, the Urn.
 * What comes back after someone takes it (camps after a clear, a statue after it breaks,
 * the Mid-Boss after a kill) depends on the players, so here it stays up once it is up,
 * and the respawn rule is written beside it instead. The Rift and the Broker come at
 * times the game picks for itself, so they are written down rather than placed.
 *
 * The numbers were measured on five replays (four before the 2026-10 update, one after)
 * and agree with the guides; see the Map flow tab for the same figures read off any
 * match.
 */

export type MapVersion = 'current' | 'legacy'

type Layout = typeof current

const LAYOUTS: Record<MapVersion, Layout> = { current, legacy: legacy as Layout }

/** How long the stand-in match runs: an hour, longer than nearly any real one. */
export const TIMINGS_DURATION = 3600

/** When each thing first appears, in game seconds. */
const FIRST = {
  camps: { 1: 120, 2: 300, 3: 480 } as Record<number, number>,
  snacks: 150,
  breakables: 180,
  sinners: 480,
  powerups: 300,
  urn: 600,
}
/** Powerups and the Urn come every this many seconds. */
const EVERY = 300

/**
 * How soon each comes back once taken, in seconds -- the usual delay, measured on five
 * replays (crates and tough crates vary most: about 4-5 and 5 minutes). Used when the
 * page cycles: see `timingsMatch`.
 */
const BACK = {
  camps: { 1: 85, 2: 290, 3: 335 } as Record<number, number>,
  snacks: 180,
  crates: 270,
  toughCrates: 300,
  statues: 180,
  sinners: 300,
}
/** The Mid-Boss: first killed at 10:00 when cycling -- the earliest the guides have it
 * fought; no replay we have saw it hit before 17:00 -- then back 7:00, 6:00, 5:00, and
 * 5:00 from then on. */
const MID_BOSS_FIRST_KILL = 600
const MID_BOSS_BACK = [420, 360, 300]
/** When cycling, how long a thing shows once it appears before it counts as taken: long
 * enough to see it pop up on the map. */
const SHOWN = 5

/** Every time a thing appears, from `first`: once if it stays, else again `back` after
 * each time it was taken (`SHOWN` after it appeared). */
function appearances(first: number, back: number | null): number[] {
  if (back === null) return [first]
  const out: number[] = []
  for (let at = first; at < TIMINGS_DURATION; at += SHOWN + back) out.push(at)
  return out
}

/** The rules, as the side panel states them. `first` is given as text where the game
 * picks the moment itself. */
export function timingRules(version: MapVersion): ScheduleRow[] {
  const at = (seconds: number) => seconds
  const rows: ScheduleRow[] = [
    { id: 'troopers', label: 'Lane troopers', first: 16, again: 'a wave every 30 s' },
    { id: 'camps1', label: 'Tier 1 camps', first: at(FIRST.camps[1]), again: '1:25 after a clear' },
    { id: 'camps2', label: 'Tier 2 camps', first: at(FIRST.camps[2]), again: '4:50 after a clear' },
    { id: 'camps3', label: 'Tier 3 camps', first: at(FIRST.camps[3]), again: '5:35 after a clear' },
  ]
  if (version === 'current')
    rows.push({ id: 'snacks', label: 'Healing snacks', first: FIRST.snacks, again: '3:00 after eaten' })
  rows.push(
    { id: 'crates', label: 'Crates', first: FIRST.breakables, again: 'about 4–5 min after broken' },
  )
  if (version === 'current')
    rows.push({ id: 'toughCrates', label: 'Tough crates', first: FIRST.breakables, again: 'about 5 min after broken' })
  rows.push(
    { id: 'statues', label: 'Golden statues', first: FIRST.breakables, again: '3:00 after broken' },
    { id: 'sinners', label: "Sinner's Sacrifice", first: FIRST.sinners, again: '5:00 after broken' },
    { id: 'powerups', label: 'Powerups', first: FIRST.powerups, again: 'every 5:00, both spots' },
    { id: 'urn', label: 'Urn', first: FIRST.urn, again: 'every 5:00, sides alternate, west first' },
    { id: 'midBoss', label: 'Mid-Boss', first: 0, again: 'back 7:00 after a kill, then 6:00, 5:00' },
    {
      id: 'rift',
      label: 'Unstable Rift',
      first: null,
      firstText: '10–12 min',
      again: `every 6–8 min, bridges alternate; opens ${version === 'current' ? 80 : 20} s after the warning`,
    },
  )
  if (version === 'current')
    rows.push({ id: 'broker', label: 'The Broker', first: null, firstText: 'about 30:00', again: 'new stock about every 15:00' })
  return rows
}

const q = (v: number) => Math.round(v / 16)

/** Breakable spots that all appear at `first` and, without `back`, stand from then on;
 * with it, are taken as they appear and come back `back` later, over and over. */
function standing(points: number[][], first: number, hz: number, back: number | null = null): Breakables {
  const out: Breakables = { t: [], x: [], y: [], broken: [], by: [] }
  const times = appearances(first, back)
  for (const at of times)
    for (const [x, y] of points) {
      out.t.push(at * hz)
      out.x.push(q(x))
      out.y.push(q(y))
      out.broken.push(back === null ? -1 : (at + SHOWN) * hz)
      out.by.push(-1)
    }
  return out
}

/**
 * The stand-in match for `version`: see the module note. With `cycle`, everything that
 * comes back after it is taken is taken the moment it appears and comes back after its
 * usual delay, over and over -- the soonest each can return, so its timer is always
 * running. The Urn and the powerups come on their own clock either way.
 */
export function timingsMatch(version: MapVersion, cycle = false): Timeline {
  const map = LAYOUTS[version]
  const hz = 64
  const frames = TIMINGS_DURATION + 1

  // Powerups: one at each spot every five minutes, there until the next drop.
  const powerups = { t: [] as number[], x: [] as number[], y: [] as number[], broken: [] as number[], by: [] as number[], kind: [] as never[] }
  for (let at = FIRST.powerups; at < TIMINGS_DURATION; at += EVERY)
    for (const [x, y] of map.powerups) {
      powerups.t.push(at * hz)
      powerups.x.push(q(x))
      powerups.y.push(q(y))
      powerups.broken.push(Math.min(cycle ? at + SHOWN : at + EVERY, TIMINGS_DURATION) * hz)
      powerups.by.push(-1)
      // Which kind drops is random, so none is named.
      powerups.kind.push('random' as never)
    }

  // The Urn: west first, then alternating sides every five minutes.
  const urn = { t: [] as number[], kind: [] as 'spawn'[], player: [] as number[], x: [] as number[], y: [] as number[] }
  const sides = map.urnFirst === 'east' ? ['east', 'west'] : ['west', 'east']
  let k = 0
  for (let at = FIRST.urn; at < TIMINGS_DURATION; at += EVERY, k++) {
    const [x, y] = (map.urn as Record<string, number[]>)[sides[k % 2]] ?? [0, 0]
    urn.t.push(at * hz)
    urn.kind.push('spawn')
    urn.player.push(-1)
    urn.x.push(q(x))
    urn.y.push(q(y))
  }

  // Camps: one creep at each camp at its tier's first spawn -- never cleared, or, when
  // cycling, cleared as it appears and back after its tier's delay.
  const camps = map.camps
  const neutrals = { t: [] as number[], x: [] as number[], y: [] as number[], died: [] as number[], tier: [] as number[] }
  for (const camp of camps)
    for (const at of appearances(FIRST.camps[camp.tier], cycle ? BACK.camps[camp.tier] : null)) {
      neutrals.t.push(at * hz)
      neutrals.x.push(q(camp.x))
      neutrals.y.push(q(camp.y))
      neutrals.died.push(cycle ? (at + SHOWN) * hz : -1)
      neutrals.tier.push(camp.tier)
    }

  // The Mid-Boss stands from the start; when cycling it falls at 10:00 and comes back
  // after 7:00, 6:00, then 5:00 each time.
  const bossHp = new Array<number>(frames).fill(100)
  const bossKills: number[] = []
  if (cycle)
    for (let kill = MID_BOSS_FIRST_KILL, n = 0; kill < TIMINGS_DURATION; n++) {
      const back = MID_BOSS_BACK[Math.min(n, MID_BOSS_BACK.length - 1)]
      bossKills.push(kill)
      bossHp.fill(0, kill, Math.min(frames, kill + back))
      kill += back + SHOWN
    }

  const objectives = map.objectives.map((o) => ({
    kind: o.kind,
    team: o.team,
    x: q(o.x),
    y: q(o.y),
    hp: o.kind === 'midBoss' ? bossHp : new Array<number>(frames).fill(100),
    maxHp: new Array<number>(frames).fill(100),
  }))

  return {
    build: map.build,
    clockStart: 0,
    clock: [{ t: 0, game: 0, paused: false }],
    sampleSeconds: 1,
    duration: TIMINGS_DURATION,
    frames,
    players: [],
    series: {} as Timeline['series'],
    positions: { hz: 8, quant: 16, frames: 0, x: [], y: [], z: [], cut: [], hp: [], maxHp: [], yaw: [], tunnel: [] },
    creeps: { hz: 8, quant: 16, lives: [] },
    objectives: { quant: 16, list: objectives },
    lanes: { quant: 16, list: [] },
    tunnels: { quant: 16, lines: [] },
    shops: {
      x: map.shops.map(([x]) => q(x)),
      y: map.shops.map(([, y]) => q(y)),
      z: map.shops.map(() => -5),
      team: map.shops.map(() => 4),
    },
    events: {
      hz,
      quant: 16,
      abilities: [],
      kills: { t: [], victim: [], killer: [], cause: [], assisters: [], x: [], y: [] },
      casts: { t: [], player: [], ability: [], x: [], y: [] },
      firing: [],
      damage: { t: [], from: [], fromKind: [], to: [], toKind: [], amount: [], source: [] },
      kinds: [],
      sources: [],
      items: { t: [], player: [], id: [], sold: [] },
      neutrals,
      camps: version === 'current' ? { x: camps.map((c) => q(c.x)), y: camps.map((c) => q(c.y)) } : { x: [], y: [] },
      urn,
      rifts: { t: [], open: [], x: [], y: [], contested: [], end: [], outcome: [], team: [] },
      midBossKills: { t: bossKills.map((t) => t * hz), player: bossKills.map(() => -1) },
      crates: standing(map.crates, FIRST.breakables, hz, cycle ? BACK.crates : null),
      sinners: standing(map.sinners, FIRST.sinners, hz, cycle ? BACK.sinners : null),
      statues: standing(map.statues, FIRST.breakables, hz, cycle ? BACK.statues : null),
      toughCrates: standing(map.toughCrates, FIRST.breakables, hz, cycle ? BACK.toughCrates : null),
      bells: { t: [], x: [], y: [], broken: [], by: [] },
      broker: { t: [], limit: [] },
      snacks: standing(map.snacks, FIRST.snacks, hz, cycle ? BACK.snacks : null),
      powerups,
    },
    income: { calibrated: false, sources: [], checkpoints: [], souls: [] },
  } as unknown as Timeline
}
