import { itemOf } from '../abilities'
import { incomeFrom } from './income'
import type { IncomeSource, Timeline } from './types'

/**
 * Per-player performance over the match, one value per scoreboard frame (a second), for
 * the Performance chart. Every metric is the same shape -- `values[player][frame]` -- so
 * the chart draws any of them the same way, and averages are taken across whichever
 * players a comparison needs.
 */

export type MetricId =
  | 'netWorth'
  | 'souls'
  | 'soulsPerMin'
  | 'income'
  | 'damage'
  | 'damagePerMin'
  | 'kills'
  | 'deaths'
  | 'lastHits'
  | 'denies'

export type Metric = {
  id: MetricId
  label: string
  /** What the number is, said once under the chart. */
  note?: string
}

export const METRICS: Metric[] = [
  { id: 'netWorth', label: 'Net worth' },
  {
    id: 'souls',
    label: 'Souls',
    note: 'Unspent souls: net worth less the shop price of the items held.',
  },
  { id: 'soulsPerMin', label: 'Souls/min', note: 'Net worth per minute played so far.' },
  {
    id: 'income',
    label: 'Souls from',
    note: "Souls earned from one source so far. Estimated: the game's own split is known every 3-5 minutes, and between those points each gain is matched to what was happening -- see a player's Souls tab.",
  },
  { id: 'damage', label: 'Damage', note: 'Damage dealt to heroes.' },
  { id: 'damagePerMin', label: 'Damage/min', note: 'Hero damage per minute played so far.' },
  { id: 'kills', label: 'Kills' },
  { id: 'deaths', label: 'Deaths' },
  { id: 'lastHits', label: 'Last hits' },
  { id: 'denies', label: 'Denies' },
]

/**
 * A running total divided by minutes played. The first minute divides by one rather
 * than by the few seconds elapsed, so the line does not open on a spike that is only an
 * artefact of dividing by almost nothing -- the way per-minute rates are usually shown.
 */
function perMinute(column: number[], sampleSeconds: number) {
  return column.map((value, frame) => value / Math.max((frame * sampleSeconds) / 60, 1))
}

/**
 * Souls in hand at each frame: net worth less the shop price of what is held. Net worth
 * counts both, and a replay does not state the unspent part in a form that can be read
 * reliably (the currency array's entries collide in the entity state), but the item log
 * says what was held when, and the manifest says what each cost.
 */
export function unspentSouls(timeline: Timeline): number[][] {
  const { hz, items } = timeline.events
  const frames = timeline.frames
  return timeline.players.map((_, player) => {
    // The shop price of everything held, changed at each purchase or sale.
    const heldCost = new Array<number>(frames).fill(0)
    let cost = 0
    let frame = 0
    for (let i = 0; i < items.t.length; i++) {
      if (items.player[i] !== player) continue
      const at = Math.min(Math.floor(items.t[i] / hz / timeline.sampleSeconds), frames)
      for (; frame < at; frame++) heldCost[frame] = cost
      cost += (items.sold[i] ? -1 : 1) * (itemOf(items.id[i])?.cost ?? 0)
    }
    for (; frame < frames; frame++) heldCost[frame] = cost
    const worth = timeline.series.netWorth[player] ?? []
    return heldCost.map((held, f) => Math.max(0, (worth[f] ?? 0) - held))
  })
}

/** `values[player][frame]` for one metric; `source` picks what "Souls from" means. */
export function metricValues(
  timeline: Timeline,
  metric: MetricId,
  source: IncomeSource = 'lane',
): number[][] {
  const s = timeline.series
  const step = timeline.sampleSeconds
  switch (metric) {
    case 'netWorth':
      return s.netWorth
    case 'souls':
      return unspentSouls(timeline)
    case 'soulsPerMin':
      return s.netWorth.map((column) => perMinute(column, step))
    case 'income':
      return incomeFrom(timeline, source)
    case 'damage':
      return s.heroDamage
    case 'damagePerMin':
      return s.heroDamage.map((column) => perMinute(column, step))
    case 'kills':
      return s.kills
    case 'deaths':
      return s.deaths
    case 'lastHits':
      return s.lastHits
    case 'denies':
      return s.denies
  }
}

/** The mean of `players`' values at each frame, or null for an empty group. */
export function averageOf(values: number[][], players: number[]): number[] | null {
  if (players.length === 0) return null
  const frames = values[players[0]]?.length ?? 0
  const out = new Array<number>(frames).fill(0)
  for (const player of players) {
    const column = values[player]
    for (let f = 0; f < frames; f++) out[f] += (column?.[f] ?? 0) / players.length
  }
  return out
}

/** Round axis ticks from 0 to at least `max`: 1, 2 or 5 times a power of ten apart. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / target
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power
  const ticks: number[] = []
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}
