import { describe, expect, it } from 'vitest'
import { incomeAt, incomeFrom } from './income'
import type { Timeline } from './types'

// Two sources, one player, 120 one-second frames: 10 lane souls a second, and a kill
// worth 300 at frame 100.
const lane = Array.from({ length: 120 }, (_, f) => f * 10)
const kills = Array.from({ length: 120 }, (_, f) => (f >= 100 ? 300 : 0))
const timeline = {
  sampleSeconds: 1,
  frames: 120,
  players: [{}],
  income: {
    calibrated: true,
    sources: ['kills', 'lane'],
    checkpoints: [],
    souls: [[kills, lane]],
  },
} as unknown as Timeline

describe('incomeAt', () => {
  it('gives each source so far and over the last minute', () => {
    expect(incomeAt(timeline, 0, 110)).toEqual([
      { source: 'kills', total: 300, recent: 300 },
      { source: 'lane', total: 1100, recent: 600 },
    ])
  })

  it('counts the whole match so far as recent in the first minute', () => {
    expect(incomeAt(timeline, 0, 30)[1]).toEqual({ source: 'lane', total: 300, recent: 300 })
  })
})

describe('incomeFrom', () => {
  it('gives one source for every player', () => {
    expect(incomeFrom(timeline, 'kills')).toEqual([kills])
  })
})
