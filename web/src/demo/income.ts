import type { IncomeSource, Timeline } from './types'

/**
 * Souls earned by source, read off the parser's estimate. How that estimate is made, and
 * how far it can be trusted, is in the parser's `income.rs`; the Souls tab says it in
 * plain words.
 */

export const SOURCE_LABELS: Record<IncomeSource, string> = {
  kills: 'Hero kills',
  assists: 'Assists',
  lane: 'Lane troopers',
  neutrals: 'Neutral camps',
  objectives: 'Objectives',
  breakables: 'Crates and statues',
  teamBonus: 'Team bonus',
  other: 'Other',
}

/** Each source's colour: a categorical set, in a fixed order, so a source keeps its
 * colour whatever else is shown. */
export const SOURCE_COLOURS: Record<IncomeSource, string> = {
  kills: 'var(--data-income-kills)',
  assists: 'var(--data-income-assists)',
  lane: 'var(--data-income-lane)',
  neutrals: 'var(--data-income-neutrals)',
  objectives: 'var(--data-income-objectives)',
  breakables: 'var(--data-income-breakables)',
  teamBonus: 'var(--data-income-team-bonus)',
  other: 'var(--data-income-other)',
}

/** How far back "recent" income looks, in seconds. */
export const RECENT_SECONDS = 60

export type SourceShare = {
  source: IncomeSource
  /** Souls from this source so far. */
  total: number
  /** Souls from it in the last `RECENT_SECONDS`. */
  recent: number
}

/** One player's income by source at `frame`, in the parser's source order. */
export function incomeAt(timeline: Timeline, player: number, frame: number): SourceShare[] {
  const { income, sampleSeconds } = timeline
  const back = Math.max(0, frame - Math.round(RECENT_SECONDS / sampleSeconds))
  return income.sources.map((source, k) => {
    const column = income.souls[player]?.[k] ?? []
    const now = column[frame] ?? 0
    return { source, total: now, recent: now - (column[back] ?? 0) }
  })
}

/** `values[player][frame]`: souls from one source so far, for every player. */
export function incomeFrom(timeline: Timeline, source: IncomeSource): number[][] {
  const k = timeline.income.sources.indexOf(source)
  return timeline.players.map((_, player) => timeline.income.souls[player]?.[k] ?? [])
}
