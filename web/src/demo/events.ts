import type { KillCause, Timeline } from './types'

/**
 * Reading the event stream at a moment of playback.
 *
 * An event is an instant, and an instant is invisible: it has to stay on screen for a
 * while to be seen at all. How long is a question of the viewer's time, not the match's.
 * Half a second of match time is plenty at 1x and sixteen screen frames at 8x -- gone
 * before anyone registers it. So every "how long it stays" here is given in seconds of
 * *screen* time and turned into match time by the playback speed, which keeps an event
 * on screen for the same moment however fast the match is going by.
 */

/** Seconds of screen time a death stays marked where it happened. */
export const DEATH_LINGER = 4
/** Seconds of screen time a kill stays in the feed: long enough to read who killed whom
 * in a fight that takes three lives in a second, the way a game's own feed holds them. */
export const KILL_FEED_LINGER = 8
/** The most kills the feed shows at once. A wipe at 16x would otherwise stack a dozen
 * rows over the map; the oldest drop off first, as they would in the game. */
export const KILL_FEED_MAX = 6
/** Seconds of screen time a cast's icon stays beside its caster. */
export const CAST_LINGER = 1.5

/** Match seconds an event of `linger` screen seconds covers at `speed`. Paused
 * playback keeps its speed, so it is never zero. */
export function lingerFor(linger: number, speed: number) {
  return linger * Math.max(speed, 1)
}

/** The first index in the sorted `ticks` at or after `tick`. */
export function lowerBound(ticks: number[], tick: number) {
  let low = 0
  let high = ticks.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (ticks[mid] < tick) low = mid + 1
    else high = mid
  }
  return low
}

/**
 * The indices of events that happened within `window` match seconds up to `seconds`,
 * oldest first. Found by binary search on the sorted tick column, so the cost is the
 * handful of events on screen, not the thousands in the match.
 */
export function recent(ticks: number[], hz: number, seconds: number, window: number) {
  const from = lowerBound(ticks, (seconds - window) * hz)
  // Anything at or before now: an event exactly on the playhead has happened.
  const to = lowerBound(ticks, Math.floor(seconds * hz) + 1)
  const out: number[] = []
  for (let i = from; i < to; i++) out.push(i)
  return out
}

/** One death as it stands at a moment of playback, positions in world units. */
export type KillSpot = {
  /** This death's index in `Events.kills`: stable, so a React key. */
  id: number
  victim: number
  killer: number
  cause: KillCause
  assisters: number[]
  /** Where the victim fell. */
  x: number
  y: number
  /** Match seconds since it happened. */
  age: number
}

/** Every death within `window` match seconds up to `seconds`. */
export function killsAt(timeline: Timeline, seconds: number, window: number): KillSpot[] {
  const { hz, quant, kills } = timeline.events
  return recent(kills.t, hz, seconds, window).map((i) => {
    return {
      id: i,
      victim: kills.victim[i],
      killer: kills.killer[i],
      cause: kills.cause[i],
      assisters: kills.assisters[i],
      x: kills.x[i] * quant,
      y: kills.y[i] * quant,
      age: seconds - kills.t[i] / hz,
    }
  })
}

/** The kill feed at `seconds`: the latest `max` kills within `window` match seconds,
 * newest first. */
export function killFeed(timeline: Timeline, seconds: number, window: number, max: number) {
  return killsAt(timeline, seconds, window).slice(-max).reverse()
}

/** One cast as it stands at a moment of playback. */
export type CastSpot = {
  /** This cast's index in `Events.casts`: stable, so a React key. */
  id: number
  player: number
  /** The internal name, such as `synth_barrage`. */
  ability: string
  /** An item's active rather than one of the hero's own abilities. */
  item: boolean
  /** Match seconds since it happened. */
  age: number
}

/**
 * The latest cast of each player within `window` match seconds up to `seconds`.
 *
 * Only the latest: a caster is drawn wherever they are now, not where they stood when
 * they cast -- a label left behind at the cast point reads as something on the ground
 * there -- and two labels on one moving portrait would stack into an unreadable pile in
 * exactly the fights where casts come fastest.
 */
export function castsAt(timeline: Timeline, seconds: number, window: number): CastSpot[] {
  const { hz, abilities, casts } = timeline.events
  const latest = new Map<number, number>()
  for (const i of recent(casts.t, hz, seconds, window)) latest.set(casts.player[i], i)
  return [...latest.values()].map((i) => {
    const ability = abilities[casts.ability[i]] ?? ''
    return {
      id: i,
      player: casts.player[i],
      ability,
      item: ability.startsWith('upgrade_'),
      age: seconds - casts.t[i] / hz,
    }
  })
}

/** Every death's time in match seconds, and the team that got the kill -- the one that
 * is not the victim's -- for marking the scrubber. */
export function killMarks(timeline: Timeline) {
  const { hz, kills } = timeline.events
  return kills.t.map((t, i) => ({
    seconds: t / hz,
    victimTeam: timeline.players[kills.victim[i]]?.team ?? 0,
  }))
}

/** Each Rift that was taken or spilled: when, and by which team (-1 when it spilled),
 * for marking the scrubber. */
export function riftMarks(timeline: Timeline) {
  const { hz, rifts } = timeline.events
  return rifts.end.flatMap((end, i) =>
    end < 0 ? [] : [{ seconds: end / hz, team: rifts.team[i], outcome: rifts.outcome[i] }],
  )
}

/** Seconds of screen time a burst of fire stays shown after its last shot, so a single
 * shot is a visible flash rather than one frame. */
export const FIRE_TAIL = 0.25

/**
 * Whether each player is firing at `seconds`: inside one of their bursts, or within
 * `tail` match seconds after one ended. A binary search over each player's bursts, so it
 * costs a dozen lookups per frame however long the match.
 */
export function firingAt(timeline: Timeline, seconds: number, tail: number): boolean[] {
  const { hz, firing } = timeline.events
  const now = seconds * hz
  return timeline.players.map((_, player) => {
    const bursts = firing[player] ?? []
    // The last burst starting at or before now: bursts are [start, end] pairs.
    let low = 0
    let high = bursts.length / 2
    while (low < high) {
      const mid = (low + high) >>> 1
      if (bursts[mid * 2] <= now) low = mid + 1
      else high = mid
    }
    if (low === 0) return false
    return now <= bursts[(low - 1) * 2 + 1] + tail * hz
  })
}
