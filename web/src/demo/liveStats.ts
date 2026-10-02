import type { Series, Timeline } from './types'
import { gameSeconds, recordingSeconds } from './usePlayback'

/**
 * Every hero ranked by one stat at the playhead, for the table beside the map: a total
 * such as net worth or hero damage, or the same stat per minute, over either the match
 * so far or the last few minutes.
 *
 * A total over the match is the scoreboard's own figure, so net worth reads as the game
 * shows it. Everything else is a difference of running totals over a stretch of the
 * in-game clock, so a rate counts neither pauses nor the pre-game countdown as minutes
 * played, and starting souls do not count as souls earned. The first minute divides by
 * one rather than by the few seconds elapsed -- the same rule the Performance chart
 * uses -- so the table does not open on rates that are only an artefact of dividing by
 * almost nothing.
 */

export type StatRange = 'match' | 'recent'
export type StatUnit = 'total' | 'perMin'

/** How far back the "recent" range looks, in seconds. */
export const RECENT_RANGE_SECONDS = 180

export type StatId = 'netWorth' | 'heroDamage' | 'objectiveDamage' | 'healing' | 'lastHits'

/** The series each stat is read from. */
const SERIES: Record<StatId, keyof Series> = {
  netWorth: 'netWorth',
  heroDamage: 'heroDamage',
  objectiveDamage: 'objectiveDamage',
  healing: 'healing',
  lastHits: 'lastHits',
}

export type LiveRow = {
  player: number
  team: number
  slot: number
  level: number
  alive: boolean
  /** The stat asked for. */
  value: number
}

export function liveStats(
  timeline: Timeline,
  at: number,
  stat: StatId,
  unit: StatUnit,
  range: StatRange,
): LiveRow[] {
  const { series: s, sampleSeconds, frames } = timeline
  const clampFrame = (f: number) => Math.max(0, Math.min(frames - 1, f))
  const frame = clampFrame(Math.floor(at / sampleSeconds))
  // The frame the in-game clock read 0:00 at: nothing before it is play.
  const start = clampFrame(Math.ceil(recordingSeconds(timeline, 0) / sampleSeconds))
  // Where the range begins, or null to take the scoreboard's figure as it stands.
  const from =
    range === 'recent'
      ? Math.max(start, frame - Math.round(RECENT_RANGE_SECONDS / sampleSeconds))
      : unit === 'perMin'
        ? start
        : null
  const played =
    from !== null && frame > from
      ? gameSeconds(timeline, frame * sampleSeconds) - gameSeconds(timeline, from * sampleSeconds)
      : 0
  const minutes = Math.max(played / 60, 1)

  return timeline.players.map((player, i) => {
    const read = (column: number[][]) => {
      const now = column[i]?.[frame] ?? 0
      if (from === null) return now
      return frame > from ? now - (column[i]?.[from] ?? 0) : 0
    }
    const total = read(s[SERIES[stat]])
    return {
      player: i,
      team: player.team,
      slot: player.slot,
      level: s.level[i]?.[frame] ?? 0,
      alive: s.alive[i]?.[frame] === 1,
      value: unit === 'perMin' ? total / minutes : total,
    }
  })
}

/** `rows` highest first, ties in lobby order so rows do not shuffle on a tie. */
export function ranked(rows: LiveRow[]): LiveRow[] {
  return [...rows].sort((a, b) => b.value - a.value || a.slot - b.slot)
}
