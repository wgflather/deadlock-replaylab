import { CAMP_SITES, type CampSite } from '../map/camps'
import type { Breakables, PowerupKind, Powerups, Timeline } from './types'

/**
 * The map's timers at a moment of playback: which neutral camps are up and when the
 * rest come back, where the Urn is, and whether the Mid-Boss stands.
 *
 * A replay is recorded, not live, so "next" here is what actually happened next -- the
 * next spawn the replay saw -- rather than a prediction from the game's rules. The one
 * thing that is inferred is when a camp was cleared, where no one saw its last creep
 * fall: then it is the next spawn less that tier's respawn delay, measured from the
 * clears that were seen.
 */

/** Respawn delays in seconds, used when a tier has no clear seen to measure its own:
 * what one real match measured for each tier. */
const DEFAULT_DELAYS: Record<number, number> = { 1: 85, 2: 290, 3: 320 }

/** A creep further than this from every named camp belongs to none of them. */
const CAMP_REACH = 1200
/** Creeps spawned within this many seconds of each other at one camp are one wave. */
const WAVE_SECONDS = 5

/** One named camp, and each time it spawned in this match. */
export type CampHistory = CampSite & {
  /** Seconds. */
  spawns: number[]
  /** Seconds, or null where not every creep's death was seen; one per spawn. */
  clears: (number | null)[]
}

/** Which creeps belong to which site: each to the one nearest where it spawned. */
function membersOf(timeline: Timeline, sites: { x: number; y: number }[]): number[][] {
  const { quant, neutrals } = timeline.events
  const members: number[][] = sites.map(() => [])
  for (let i = 0; i < neutrals.t.length; i++) {
    const x = neutrals.x[i] * quant
    const y = neutrals.y[i] * quant
    let best = -1
    let bestDistance = CAMP_REACH
    sites.forEach((site, s) => {
      const distance = Math.hypot(site.x - x, site.y - y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = s
      }
    })
    if (best >= 0) members[best].push(i)
  }
  return members
}

/** A camp further than this from the centre line belongs to that side's half. */
const SIDE_REACH = 500
const SIDE_NAMES: Record<CampSite['side'], string> = {
  amber: 'Amber camp',
  sapphire: 'Sapphire camp',
  lane: 'Lane camp',
}

/**
 * The camps to track: the replay's own list where it has one (matches from the 2026-10
 * update on), else the minimap artwork's named camps from before it.
 *
 * The replay says only where a camp is, so the rest is worked out. Its tier is that of
 * the strongest creep that spawned there -- a camp can mix tiers, one big creep with
 * two smaller -- and a spot nothing ever spawned at is left out, as it could only ever
 * show as down. Sapphire is the north half, as on the older map.
 */
export function campSites(timeline: Timeline): CampSite[] {
  const spots = timeline.events.camps
  if (!spots?.x.length) return CAMP_SITES
  const { quant, neutrals } = timeline.events
  const all = spots.x.map((x, i) => ({ x: x * quant, y: spots.y[i] * quant }))
  const members = membersOf(timeline, all)
  return all.flatMap((spot, s) => {
    const tier = Math.max(0, ...members[s].map((i) => neutrals.tier?.[i] ?? 0))
    if (!members[s].length) return []
    const side: CampSite['side'] =
      spot.y > SIDE_REACH ? 'sapphire' : spot.y < -SIDE_REACH ? 'amber' : 'lane'
    return [{ name: SIDE_NAMES[side], side, tier: Math.min(3, Math.max(1, tier)) as CampSite['tier'], ...spot }]
  })
}

/**
 * Every camp's spawns and clears, from the replay's creeps and its camps (see
 * `campSites`): each creep belongs to the camp nearest where it spawned.
 */
export function campHistories(
  timeline: Timeline,
  sites: CampSite[] = campSites(timeline),
): CampHistory[] {
  const { hz, neutrals } = timeline.events
  const members = membersOf(timeline, sites)

  return sites.map((site, s) => {
    const waves: number[][] = []
    for (const i of members[s]) {
      const last = waves[waves.length - 1]
      if (last && (neutrals.t[i] - neutrals.t[last[0]]) / hz <= WAVE_SECONDS) last.push(i)
      else waves.push([i])
    }
    return {
      ...site,
      spawns: waves.map((wave) => neutrals.t[wave[0]] / hz),
      clears: waves.map((wave) =>
        wave.every((i) => neutrals.died[i] >= 0)
          ? Math.max(...wave.map((i) => neutrals.died[i])) / hz
          : null,
      ),
    }
  })
}

/** Each tier's respawn delay in seconds: the median of seen clears to the next spawn. */
export function respawnDelays(camps: CampHistory[]): Record<number, number> {
  const seen: Record<number, number[]> = {}
  for (const camp of camps) {
    camp.clears.forEach((clear, i) => {
      const next = camp.spawns[i + 1]
      if (clear === null || next === undefined || next <= clear) return
      ;(seen[camp.tier] ??= []).push(next - clear)
    })
  }
  const out: Record<number, number> = { ...DEFAULT_DELAYS }
  for (const [tier, delays] of Object.entries(seen)) {
    delays.sort((a, b) => a - b)
    out[Number(tier)] = delays[Math.floor(delays.length / 2)]
  }
  return out
}

export type CampState = {
  /** Its place in the camp list: stable, so a React key. */
  id: number
  name: string
  side: CampSite['side']
  tier: number
  x: number
  y: number
  up: boolean
  /** Seconds: when it next spawns, if it is down and the replay saw it come back. */
  nextSpawn: number | null
}

/** Every camp at `seconds`. */
export function campsAt(
  camps: CampHistory[],
  seconds: number,
  delays = respawnDelays(camps),
): CampState[] {
  return camps.map((camp, id) => {
    const at = { id, name: camp.name, side: camp.side, tier: camp.tier, x: camp.x, y: camp.y }
    let wave = -1
    while (wave + 1 < camp.spawns.length && camp.spawns[wave + 1] <= seconds) wave++
    if (wave < 0) return { ...at, up: false, nextSpawn: camp.spawns[0] ?? null }

    const next = camp.spawns[wave + 1] ?? null
    // Unseen: the next spawn less the respawn delay -- but never before this wave
    // spawned, which a creep joining a camp mid-life would otherwise produce.
    const cleared =
      camp.clears[wave] ??
      (next === null ? null : Math.max(camp.spawns[wave], next - (delays[camp.tier] ?? 0)))
    const up = cleared === null || seconds < cleared
    return { ...at, up, nextSpawn: up ? null : next }
  })
}

export type UrnState =
  | { state: 'waiting'; nextSpawn: number | null }
  | { state: 'onMap'; x: number; y: number; since: number }
  | {
      state: 'carried'
      player: number
      since: number
      /** Where it has to be taken: the far side from where it spawned. */
      destination: { x: number; y: number } | null
    }
  | { state: 'delivered'; player: number; at: number; nextSpawn: number | null }

/** Where the Urn is at `seconds`. */
export function urnAt(timeline: Timeline, seconds: number): UrnState {
  const { hz, quant, urn } = timeline.events
  let last = -1
  while (last + 1 < urn.t.length && urn.t[last + 1] / hz <= seconds) last++
  const nextSpawn = () => {
    for (let i = last + 1; i < urn.t.length; i++) if (urn.kind[i] === 'spawn') return urn.t[i] / hz
    return null
  }
  if (last < 0) return { state: 'waiting', nextSpawn: nextSpawn() }
  const since = urn.t[last] / hz
  switch (urn.kind[last]) {
    case 'spawn':
    case 'drop':
      return { state: 'onMap', x: urn.x[last] * quant, y: urn.y[last] * quant, since }
    case 'pickup': {
      // Measured on two matches: always delivered to the side it did not spawn on, the
      // mirror of its spawn point.
      let spawn = last
      while (spawn >= 0 && urn.kind[spawn] !== 'spawn') spawn--
      const destination = spawn >= 0 ? { x: -urn.x[spawn] * quant, y: urn.y[spawn] * quant } : null
      return { state: 'carried', player: urn.player[last], since, destination }
    }
    case 'deliver':
      return { state: 'delivered', player: urn.player[last], at: since, nextSpawn: nextSpawn() }
  }
}

/** The Rift's capture circle, in world units: the game's 20 metres. */
export const RIFT_RADIUS = 787.4

export type RiftState =
  | { state: 'none'; next: number | null }
  | { state: 'announced'; x: number; y: number; opensAt: number }
  | { state: 'open'; x: number; y: number; since: number; contested: boolean }
  | {
      state: 'over'
      outcome: 'captured' | 'released'
      /** The capturing team, or -1 when it spilled. */
      team: number
      at: number
      next: number | null
    }

/** The Unstable Rift at `seconds`, with how many each team has taken by then. */
export function riftAt(timeline: Timeline, seconds: number): RiftState & { taken: Map<number, number> } {
  const { hz, quant, rifts } = timeline.events
  const taken = new Map<number, number>()
  // When each Rift was first known of: its warning, or its opening if the replay missed that.
  const start = (i: number) => (rifts.t[i] >= 0 ? rifts.t[i] : rifts.open[i]) / hz
  let last = -1
  for (let i = 0; i < rifts.t.length && start(i) <= seconds; i++) {
    last = i
    const end = rifts.end[i]
    if (rifts.outcome[i] === 'captured' && end >= 0 && end / hz <= seconds) {
      taken.set(rifts.team[i], (taken.get(rifts.team[i]) ?? 0) + 1)
    }
  }
  const next = last + 1 < rifts.t.length ? start(last + 1) : null
  if (last < 0) return { state: 'none', next, taken }
  const x = rifts.x[last] * quant
  const y = rifts.y[last] * quant
  const open = rifts.open[last] / hz
  const end = rifts.end[last] / hz
  if (rifts.open[last] < 0 || seconds < open) {
    return { state: 'announced', x, y, opensAt: rifts.open[last] < 0 ? Infinity : open, taken }
  }
  if (rifts.end[last] < 0 || seconds < end) {
    const contested = rifts.contested[last] >= 0 && rifts.contested[last] / hz <= seconds
    return { state: 'open', x, y, since: open, contested, taken }
  }
  const outcome = rifts.outcome[last] === 'released' ? 'released' : 'captured'
  return { state: 'over', outcome, team: rifts.team[last], at: end, next, taken }
}

export type MidBossState =
  | { state: 'up'; hpFraction: number }
  | { state: 'down'; killedAt: number | null; killer: number | null; nextSpawn: number | null }

/** The Mid-Boss at `seconds`, from its objective track and the kill messages. */
export function midBossAt(timeline: Timeline, seconds: number): MidBossState {
  const boss = timeline.objectives.list.find((o) => o.kind === 'midBoss')
  const frame = Math.max(
    0,
    Math.min(Math.floor(seconds / timeline.sampleSeconds), timeline.frames - 1),
  )
  if (boss && boss.hp[frame] > 0) {
    return {
      state: 'up',
      hpFraction: boss.maxHp[frame] > 0 ? boss.hp[frame] / boss.maxHp[frame] : 0,
    }
  }
  const { hz, midBossKills } = timeline.events
  let kill = -1
  while (kill + 1 < midBossKills.t.length && midBossKills.t[kill + 1] / hz <= seconds) kill++
  let nextSpawn: number | null = null
  if (boss) {
    for (let f = frame + 1; f < boss.hp.length; f++) {
      if (boss.hp[f] > 0) {
        nextSpawn = f * timeline.sampleSeconds
        break
      }
    }
  }
  return {
    state: 'down',
    killedAt: kill >= 0 ? midBossKills.t[kill] / hz : null,
    killer: kill >= 0 && midBossKills.player[kill] >= 0 ? midBossKills.player[kill] : null,
    nextSpawn,
  }
}

/** One crate or Sinner's Sacrifice spot at a moment of playback. */
export type BreakableSpot = {
  /** Its place in the spot list: stable, so a React key. */
  id: number
  x: number
  y: number
  standing: boolean
  /** Seconds: when it next spawns, if it is down and the replay saw it come back. */
  nextSpawn: number | null
}

/** The spots crates or Sinner's Sacrifices stand on, each with its lives in order. */
export function breakableSpots(list: Breakables): { x: number; y: number; lives: number[] }[] {
  const spots = new Map<string, { x: number; y: number; lives: number[] }>()
  list.t.forEach((_, i) => {
    const key = `${list.x[i]},${list.y[i]}`
    let spot = spots.get(key)
    if (!spot) spots.set(key, (spot = { x: list.x[i], y: list.y[i], lives: [] }))
    spot.lives.push(i)
  })
  return [...spots.values()]
}

/** Every spot at `seconds`: standing or not, and when the next one spawns there. */
export function breakablesAt(
  list: Breakables,
  spots: ReturnType<typeof breakableSpots>,
  hz: number,
  quant: number,
  seconds: number,
): BreakableSpot[] {
  const tick = seconds * hz
  return spots.map((spot, id) => {
    let life = -1
    while (life + 1 < spot.lives.length && list.t[spot.lives[life + 1]] <= tick) life++
    const current = life >= 0 ? spot.lives[life] : -1
    const standing = current >= 0 && (list.broken[current] < 0 || list.broken[current] > tick)
    const next = spot.lives[life + 1]
    return {
      id,
      x: spot.x * quant,
      y: spot.y * quant,
      standing,
      nextSpawn: !standing && next !== undefined ? list.t[next] / hz : null,
    }
  })
}

/** A powerup spawner's spot at a moment: like a breakable's, plus which powerup is
 * there to take, if one is. */
export type PowerupSpot = BreakableSpot & { kind: PowerupKind | null }

/** Both powerup spots at `seconds`. */
export function powerupsAt(
  list: Powerups,
  spots: ReturnType<typeof breakableSpots>,
  hz: number,
  quant: number,
  seconds: number,
): PowerupSpot[] {
  const tick = seconds * hz
  return breakablesAt(list, spots, hz, quant, seconds).map((spot, id) => {
    const lives = spots[id].lives
    let life = -1
    while (life + 1 < lives.length && list.t[lives[life + 1]] <= tick) life++
    return { ...spot, kind: spot.standing ? list.kind[lives[life]] : null }
  })
}

/** One break credited to a player, for their panel. */
export type Break = {
  seconds: number
  kind: 'crate' | 'sinner' | 'statue' | 'snack' | 'powerup'
  /** Which powerup, for a powerup. */
  powerup?: PowerupKind
}

/** Every crate, statue and Sinner's Sacrifice `player` was credited with breaking, and
 * every Healing Snack and powerup they took, up to `seconds`, oldest first. */
export function breaksBy(timeline: Timeline, player: number, seconds: number): Break[] {
  const { hz, crates, sinners } = timeline.events
  const out: Break[] = []
  const take = (list: Breakables, kind: Break['kind']) => {
    list.by.forEach((by, i) => {
      const at = list.broken[i] / hz
      if (by === player && list.broken[i] >= 0 && at <= seconds) out.push({ seconds: at, kind })
    })
  }
  take(crates, 'crate')
  take(sinners, 'sinner')
  take(timeline.events.statues, 'statue')
  take(timeline.events.snacks, 'snack')
  const { powerups } = timeline.events
  powerups.by.forEach((by, i) => {
    const at = powerups.broken[i] / hz
    if (by === player && powerups.broken[i] >= 0 && at <= seconds)
      out.push({ seconds: at, kind: 'powerup', powerup: powerups.kind[i] })
  })
  return out.sort((a, b) => a.seconds - b.seconds)
}

/** How many Urns `player` delivered up to `seconds`. */
export function urnsDeliveredBy(timeline: Timeline, player: number, seconds: number): number[] {
  const { hz, urn } = timeline.events
  return urn.t
    .map((t, i) => ({ t: t / hz, i }))
    .filter(({ t, i }) => urn.kind[i] === 'deliver' && urn.player[i] === player && t <= seconds)
    .map(({ t }) => t)
}
