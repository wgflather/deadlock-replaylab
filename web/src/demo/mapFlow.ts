import { campHistories, respawnDelays, type CampHistory } from './mapState'
import type { Breakables, Timeline } from './types'

/**
 * How the map itself runs over a match, with the players left out: when each thing first
 * appears, how soon it comes back, what is coming up next, and what happened to it --
 * all read off the replay rather than written down, so it stays right when a patch moves
 * a timer. Every time here is seconds into the recording, like the rest of the viewer;
 * show them with `gameClock`.
 */

/** One kind of thing on the map, as it ran in this match. */
export type ScheduleRow = {
  id: string
  label: string
  /** When it first appeared, or null if it never did. */
  first: number | null
  /** The first time in words, where it is not one moment ("10–12 min"). */
  firstText?: string
  /** How it comes back, in words ("every 5:00", "4:53 after a clear"), or null. */
  again: string | null
}

/** Something due after the playhead. */
export type Upcoming = { at: number; label: string }

/** A stretch of time on a track, and how to draw it. */
export type Span = { from: number; to: number; colour: string; faint?: boolean; title: string }
/** A moment on a track. */
export type Mark = { at: number; colour: string; title: string }
/** A share over time, 0 to 1, sampled every `FLOW_STEP` seconds from 0. */
export type Level = { values: number[]; colour: string }

export type Track = {
  id: string
  label: string
  spans: Span[]
  marks: Mark[]
  level?: Level
}

/** How often a level is sampled, in seconds. */
export const FLOW_STEP = 5

const TEAM_COLOUR: Record<number, string> = {
  2: 'var(--data-team-amber)',
  3: 'var(--data-team-sapphire)',
}
const TEAM_NAME: Record<number, string> = { 2: 'Amber', 3: 'Sapphire' }

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** A duration as the game clock writes one: 4:53. */
export function duration(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** For each spot of a breakable kind, the delay from a break to the next life there. */
function comebacks(list: Breakables, hz: number): number[] {
  const spots = new Map<string, number[]>()
  list.t.forEach((_, i) => {
    const key = `${list.x[i]},${list.y[i]}`
    let lives = spots.get(key)
    if (!lives) spots.set(key, (lives = []))
    lives.push(i)
  })
  const out: number[] = []
  for (const lives of spots.values())
    for (let k = 0; k + 1 < lives.length; k++) {
      const broke = list.broken[lives[k]]
      if (broke >= 0) out.push((list.t[lives[k + 1]] - broke) / hz)
    }
  return out
}

/** Gaps between consecutive times, each list's own, pooled. */
function cadence(lists: number[][]): number[] {
  return lists.flatMap((times) => {
    const sorted = [...times].sort((a, b) => a - b)
    return sorted.slice(1).map((t, i) => t - sorted[i])
  })
}

/** Distinct moments: times within `within` seconds of the last kept one are one. */
function moments(times: number[], within = 5): number[] {
  const out: number[] = []
  for (const t of [...times].sort((a, b) => a - b))
    if (!out.length || t - out[out.length - 1] > within) out.push(t)
  return out
}

/** The Mid-Boss's lives: when it stood, from its own health track. */
function midBossLives(timeline: Timeline): { from: number; to: number }[] {
  const boss = timeline.objectives.list.find((o) => o.kind === 'midBoss')
  if (!boss) return []
  const out: { from: number; to: number }[] = []
  let from: number | null = null
  boss.hp.forEach((hp, i) => {
    const t = i * timeline.sampleSeconds
    if (hp > 0 && from === null) from = t
    if (hp <= 0 && from !== null) {
      out.push({ from, to: t })
      from = null
    }
  })
  if (from !== null) out.push({ from, to: boss.hp.length * timeline.sampleSeconds })
  return out
}

/** Lane trooper waves, per spawn point: the times each one sent a wave. */
function troopWaves(timeline: Timeline): number[][] {
  const { lives, hz, quant } = timeline.creeps
  const points = new Map<string, number[]>()
  for (const life of lives) {
    // Spawn points are far apart; a coarse grid keeps a point's creeps together.
    const key = `${life.team}@${Math.round((life.x[0] * quant) / 1500)},${Math.round((life.y[0] * quant) / 1500)}`
    let times = points.get(key)
    if (!times) points.set(key, (times = []))
    times.push(life.startFrame / hz)
  }
  return [...points.values()].filter((times) => times.length >= 10).map((times) => moments(times, 4))
}

export function schedule(timeline: Timeline): ScheduleRow[] {
  const e = timeline.events
  const hz = e.hz
  const rows: ScheduleRow[] = []
  const add = (id: string, label: string, first: number | null, again: string | null) =>
    rows.push({ id, label, first, again })

  const waves = troopWaves(timeline)
  const waveGap = median(cadence(waves))
  add(
    'troopers',
    'Lane troopers',
    waves.length ? Math.min(...waves.map((w) => w[0])) : null,
    waveGap === null ? null : `a wave every ${Math.round(waveGap)} s`,
  )

  const camps = campHistories(timeline)
  const delays = respawnDelays(camps)
  for (const tier of [1, 2, 3]) {
    // First seen by the creeps' own tier: a camp's tier is its strongest creep, and some
    // camps grow stronger over a match, so a camp's first spawn can be a lower tier's.
    const spawns = e.neutrals.t.filter((_, i) => e.neutrals.tier?.[i] === tier).map((t) => t / hz)
    const first = spawns.length
      ? Math.min(...spawns)
      : Math.min(...camps.filter((c) => c.tier === tier).flatMap((c) => c.spawns))
    if (!Number.isFinite(first)) continue
    add(
      `camps${tier}`,
      `Tier ${tier} camps`,
      first,
      delays[tier] ? `${duration(delays[tier])} after a clear` : null,
    )
  }

  const breakable = (id: string, label: string, list: Breakables | undefined, verb: string) => {
    if (!list?.t.length) return
    const back = median(comebacks(list, hz))
    add(id, label, Math.min(...list.t) / hz, back === null ? null : `${duration(back)} after ${verb}`)
  }
  breakable('snacks', 'Healing snacks', e.snacks, 'eaten')
  breakable('crates', 'Crates', e.crates, 'broken')
  breakable('toughCrates', 'Tough crates', e.toughCrates, 'broken')
  breakable('statues', 'Golden statues', e.statues, 'broken')
  breakable('sinners', "Sinner's Sacrifice", e.sinners, 'broken')

  const drops = moments(e.powerups.t.map((t) => t / hz))
  const dropGap = median(cadence([drops]))
  if (drops.length)
    add('powerups', 'Powerups', drops[0], dropGap === null ? null : `every ${duration(dropGap)}`)

  const urns = e.urn.t.filter((_, i) => e.urn.kind[i] === 'spawn').map((t) => t / hz)
  const urnGap = median(cadence([urns]))
  if (urns.length) add('urn', 'Urn', urns[0], urnGap === null ? null : `every ${duration(urnGap)}, sides alternate`)

  const lives = midBossLives(timeline)
  const backs = lives.slice(1).map((life, i) => life.from - lives[i].to)
  // It stands in its pit from the start of the match; when it can first be fought, the
  // replay does not say.
  add(
    'midBoss',
    'Mid-Boss',
    lives.length ? lives[0].from : null,
    backs.length
      ? `back after ${backs.map(duration).join(', then ')}`
      : e.midBossKills.t.length
        ? 'killed once; not back before the end'
        : 'never killed',
  )

  const rifts = e.rifts.t.filter((t) => t >= 0).map((t) => t / hz)
  const riftGap = median(cadence([rifts]))
  const lead = median(
    e.rifts.t.flatMap((t, i) => (t >= 0 && e.rifts.open[i] >= 0 ? [(e.rifts.open[i] - t) / hz] : [])),
  )
  if (rifts.length)
    add(
      'rift',
      'Unstable Rift',
      rifts[0],
      [riftGap === null ? null : `about every ${duration(riftGap)}`, lead === null ? null : `opens ${Math.round(lead)} s after the warning`]
        .filter(Boolean)
        .join('; ') || null,
    )

  const shipments = (e.broker?.t ?? []).map((t) => t / hz)
  if (shipments.length) {
    const gap = median(cadence([shipments]))
    add('broker', 'The Broker', shipments[0], gap === null ? null : `new stock every ${duration(gap)}`)
  }
  return rows
}

/** The next few things due after `seconds`, soonest first. */
export function upcoming(
  timeline: Timeline,
  seconds: number,
  camps: CampHistory[] = campHistories(timeline),
  count = 6,
): Upcoming[] {
  const e = timeline.events
  const hz = e.hz
  const out: Upcoming[] = []
  const next = (times: number[], label: string) => {
    const t = times.filter((x) => x > seconds).sort((a, b) => a - b)[0]
    if (t !== undefined) out.push({ at: t, label })
  }
  for (const tier of [1, 2, 3])
    next(
      camps.filter((c) => c.tier === tier).flatMap((c) => c.spawns),
      `Tier ${tier} camp`,
    )
  next(moments(e.powerups.t.map((t) => t / hz)), 'Powerups drop')
  e.urn.t.forEach((t, i) => {
    if (e.urn.kind[i] === 'spawn' && t / hz > seconds)
      out.push({ at: t / hz, label: `Urn (${e.urn.x[i] < 0 ? 'west' : 'east'})` })
  })
  next(midBossLives(timeline).slice(1).map((l) => l.from), 'Mid-Boss back')
  e.rifts.t.forEach((t, i) => {
    const side = e.rifts.x[i] < 0 ? 'west' : 'east'
    if (t / hz > seconds) out.push({ at: t / hz, label: `Rift warning (${side})` })
    else if (e.rifts.open[i] / hz > seconds) out.push({ at: e.rifts.open[i] / hz, label: `Rift opens (${side})` })
  })
  next(moments(e.sinners.t.map((t) => t / hz)), "Sinner's Sacrifice")
  next((e.broker?.t ?? []).map((t) => t / hz), 'Broker shipment')
  // One of each kind, soonest first: the Urn and Rift can list more than one ahead.
  const seen = new Set<string>()
  return out
    .sort((a, b) => a.at - b.at)
    .filter((u) => {
      const kind = u.label.split(' (')[0]
      if (seen.has(kind)) return false
      seen.add(kind)
      return true
    })
    .slice(0, count)
}

/** How many of `list`'s spots stand at each `FLOW_STEP`, as a share of all of them. */
function standing(list: Breakables | undefined, hz: number, end: number): number[] | null {
  if (!list?.t.length) return null
  const spots = new Set(list.t.map((_, i) => `${list.x[i]},${list.y[i]}`)).size
  const steps = Math.ceil(end / FLOW_STEP) + 1
  const delta = new Array<number>(steps + 1).fill(0)
  list.t.forEach((t, i) => {
    const from = Math.ceil(t / hz / FLOW_STEP)
    const to = list.broken[i] < 0 ? steps : Math.ceil(list.broken[i] / hz / FLOW_STEP)
    if (from >= to) return
    delta[Math.min(from, steps)] += 1
    delta[Math.min(to, steps)] -= 1
  })
  const out: number[] = []
  let up = 0
  for (let k = 0; k < steps; k++) out.push((up += delta[k]) / spots)
  return out
}

export function tracks(timeline: Timeline): Track[] {
  const e = timeline.events
  const hz = e.hz
  const end = timeline.duration
  const out: Track[] = []

  // Structures falling, coloured by the side that lost them.
  const names: Record<string, string> = {
    guardian: 'Guardian',
    walker: 'Walker',
    baseGuardian: 'Base Guardian',
    shrine: 'Shrine',
    patron: 'Patron',
  }
  const falls: Mark[] = []
  for (const o of timeline.objectives.list) {
    if (o.kind === 'midBoss') continue
    const i = o.hp.findIndex((hp, k) => k > 0 && hp <= 0 && o.hp[k - 1] > 0)
    if (i < 0) continue
    falls.push({
      at: i * timeline.sampleSeconds,
      colour: TEAM_COLOUR[o.team] ?? 'var(--ui-muted)',
      title: `${TEAM_NAME[o.team] ?? ''} ${names[o.kind] ?? o.kind} fell`,
    })
  }
  out.push({ id: 'structures', label: 'Structures', spans: [], marks: falls })

  out.push({
    id: 'midBoss',
    label: 'Mid-Boss',
    spans: midBossLives(timeline).map((l) => ({
      from: l.from,
      to: l.to,
      colour: 'var(--data-camp)',
      title: 'Mid-Boss standing',
    })),
    marks: e.midBossKills.t.map((t, i) => {
      const team = timeline.players[e.midBossKills.player[i]]?.team
      return {
        at: t / hz,
        colour: TEAM_COLOUR[team ?? 0] ?? 'var(--ui-fg)',
        title: `Mid-Boss killed${team ? ` by ${TEAM_NAME[team]}` : ''}`,
      }
    }),
  })

  const rift: Span[] = []
  e.rifts.t.forEach((t, i) => {
    const open = e.rifts.open[i]
    const shut = e.rifts.end[i] < 0 ? end * hz : e.rifts.end[i]
    const side = e.rifts.x[i] < 0 ? 'west' : 'east'
    if (t >= 0 && open > t)
      rift.push({ from: t / hz, to: open / hz, colour: 'var(--data-rift)', faint: true, title: `Rift warning (${side})` })
    if (open >= 0)
      rift.push({
        from: open / hz,
        to: shut / hz,
        colour: TEAM_COLOUR[e.rifts.team[i]] ?? 'var(--data-rift)',
        title: `Rift (${side}): ${e.rifts.outcome[i] === 'captured' ? `${TEAM_NAME[e.rifts.team[i]]} took it` : e.rifts.outcome[i]}`,
      })
  })
  out.push({ id: 'rift', label: 'Unstable Rift', spans: rift, marks: [] })

  // The Urn: from its spawn to its delivery, in the delivering side's colour.
  const urn: Span[] = []
  let spawned: number | null = null
  e.urn.t.forEach((t, i) => {
    if (e.urn.kind[i] === 'spawn') {
      // Still out when the next one came: it stood until then.
      if (spawned !== null)
        urn.push({ from: spawned, to: t / hz, colour: 'var(--ui-muted)', title: `Urn (${e.urn.x[i] < 0 ? 'east' : 'west'})` })
      spawned = t / hz
    }
    if (e.urn.kind[i] === 'deliver' && spawned !== null) {
      const team = timeline.players[e.urn.player[i]]?.team ?? 0
      urn.push({ from: spawned, to: t / hz, colour: TEAM_COLOUR[team] ?? 'var(--ui-muted)', title: `Urn delivered by ${TEAM_NAME[team] ?? 'someone'}` })
      spawned = null
    }
  })
  if (spawned !== null) urn.push({ from: spawned, to: end, colour: 'var(--ui-muted)', title: 'Urn not delivered' })
  out.push({ id: 'urn', label: 'Urn', spans: urn, marks: [] })

  const powerups: Span[] = e.powerups.t.map((t, i) => {
    const taken = e.powerups.broken[i]
    const team = timeline.players[e.powerups.by[i]]?.team
    return {
      from: t / hz,
      to: taken < 0 ? end : taken / hz,
      colour: team ? TEAM_COLOUR[team] : 'var(--data-powerup)',
      title: `${e.powerups.kind[i]} powerup${team ? `, taken by ${TEAM_NAME[team]}` : ''}`,
    }
  })
  out.push({ id: 'powerups', label: 'Powerups', spans: powerups, marks: [] })

  if (e.broker?.t.length)
    out.push({
      id: 'broker',
      label: 'The Broker',
      spans: [],
      marks: e.broker.t.map((t) => ({ at: t / hz, colour: 'var(--ui-fg)', title: 'Broker shipment' })),
    })

  // The things that come back: how much of each is up, over the match.
  const camps = campHistories(timeline)
  const delays = respawnDelays(camps)
  for (const tier of [1, 2, 3]) {
    const inTier = camps.filter((c) => c.tier === tier)
    if (!inTier.length) continue
    const steps = Math.ceil(end / FLOW_STEP) + 1
    const values = Array.from({ length: steps }, (_, k) => {
      const at = k * FLOW_STEP
      let up = 0
      for (const camp of inTier) {
        let wave = -1
        while (wave + 1 < camp.spawns.length && camp.spawns[wave + 1] <= at) wave++
        if (wave < 0) continue
        const next = camp.spawns[wave + 1]
        const cleared =
          camp.clears[wave] ??
          (next === undefined ? null : Math.max(camp.spawns[wave], next - (delays[camp.tier] ?? 0)))
        if (cleared === null || at < cleared) up++
      }
      return up / inTier.length
    })
    out.push({ id: `camps${tier}`, label: `Tier ${tier} camps up`, spans: [], marks: [], level: { values, colour: 'var(--data-camp)' } })
  }
  const level = (id: string, label: string, list: Breakables | undefined, colour: string) => {
    const values = standing(list, hz, end)
    if (values) out.push({ id, label, spans: [], marks: [], level: { values, colour } })
  }
  level('sinners', "Sinner's up", e.sinners, 'var(--data-sinner)')
  level('statues', 'Statues up', e.statues, 'var(--data-statue)')
  level('crates', 'Crates up', e.crates, 'var(--data-crate)')
  level('toughCrates', 'Tough crates up', e.toughCrates, 'var(--data-crate)')
  level('snacks', 'Snacks up', e.snacks, 'var(--data-snack)')
  return out
}
