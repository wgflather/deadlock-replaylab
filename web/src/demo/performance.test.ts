import { describe, expect, it } from 'vitest'
import { averageOf, metricValues, niceTicks, unspentSouls } from './performance'
import type { Timeline } from './types'

// Endurance, 800 souls in the manifest.
const ENDURANCE = 2829638276

const timeline = {
  sampleSeconds: 1,
  frames: 5,
  players: [{}, {}],
  series: {
    netWorth: [
      [0, 500, 1000, 1500, 2000],
      [0, 100, 200, 300, 400],
    ],
    heroDamage: [
      [0, 60, 120, 180, 240],
      [0, 0, 0, 0, 0],
    ],
  },
  events: {
    hz: 64,
    // Player 0 buys Endurance at 2s and sells it at 4s.
    items: { t: [128, 256], player: [0, 0], id: [ENDURANCE, ENDURANCE], sold: [0, 1] },
  },
} as unknown as Timeline

describe('unspentSouls', () => {
  it('is net worth less the price of what is held, from the moment of purchase', () => {
    expect(unspentSouls(timeline)[0]).toEqual([0, 500, 200, 700, 2000])
    expect(unspentSouls(timeline)[1]).toEqual([0, 100, 200, 300, 400])
  })
})

describe('metricValues', () => {
  it('divides by at least one minute for a per-minute rate', () => {
    // Under a minute in, the rate is the running total itself.
    expect(metricValues(timeline, 'damagePerMin')[0]).toEqual([0, 60, 120, 180, 240])
  })
})

describe('averageOf', () => {
  it('averages the chosen players frame by frame', () => {
    expect(averageOf(timeline.series.netWorth, [0, 1])).toEqual([0, 300, 600, 900, 1200])
    expect(averageOf(timeline.series.netWorth, [])).toBeNull()
  })
})

describe('niceTicks', () => {
  it('steps by 1, 2 or 5 times a power of ten and reaches the maximum', () => {
    expect(niceTicks(37000)).toEqual([0, 10000, 20000, 30000, 40000])
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(0)).toEqual([0, 1])
  })
})
