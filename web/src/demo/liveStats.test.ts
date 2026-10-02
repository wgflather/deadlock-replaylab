import { describe, expect, it } from 'vitest'
import { liveStats, ranked } from './liveStats'
import type { Timeline } from './types'

/** Two players over `frames` one-second frames, the clock at 0:00 from frame 30. */
function timeline(
  frames: number,
  netWorth: [(f: number) => number, (f: number) => number],
  clock: Timeline['clock'] = [],
): Timeline {
  const column = (fn: (f: number) => number) => Array.from({ length: frames }, (_, f) => fn(f))
  const zero = () => 0
  const both = (a: (f: number) => number, b: (f: number) => number) => [column(a), column(b)]
  return {
    clockStart: 30,
    clock,
    sampleSeconds: 1,
    frames,
    players: [
      { slot: 0, team: 2, name: 'a' },
      { slot: 1, team: 3, name: 'b' },
    ],
    series: {
      netWorth: both(...netWorth),
      heroDamage: both(zero, zero),
      objectiveDamage: both(zero, zero),
      healing: both(zero, zero),
      lastHits: both(zero, zero),
      level: both(zero, zero),
      kills: both(zero, zero),
      deaths: both((f) => (f >= 100 ? 1 : 0), zero),
      assists: both(zero, (f) => (f >= 100 ? 2 : 0)),
      alive: both(
        () => 1,
        () => 1,
      ),
    },
  } as unknown as Timeline
}

describe('liveStats', () => {
  // Player a earns 10 souls a second from 0:00; b earns them only after 4:00.
  const tl = timeline(600, [
    (f) => 500 + Math.max(0, f - 30) * 10,
    (f) => 500 + Math.max(0, f - 270) * 20,
  ])

  it("reads a match total as the scoreboard's own figure, starting souls and all", () => {
    const [a] = liveStats(tl, 330, 'netWorth', 'total', 'match')
    expect(a.value).toBe(3500)
  })

  it('totals only the recent range when asked', () => {
    const [, b] = liveStats(tl, 330, 'netWorth', 'total', 'recent')
    expect(b.value).toBe(1200)
  })

  it('rates the match from 0:00, leaving out the countdown and starting souls', () => {
    const [a] = liveStats(tl, 330, 'netWorth', 'perMin', 'match')
    expect(a.value).toBeCloseTo(600)
  })

  it('rates only the recent range when asked', () => {
    const [a, b] = liveStats(tl, 330, 'netWorth', 'perMin', 'recent')
    expect(a.value).toBeCloseTo(600)
    // Three minutes back is 2:00; b earned for the last minute of those three.
    expect(b.value).toBeCloseTo((60 * 20) / 3)
  })

  it('divides the first minute by one rather than by the seconds so far', () => {
    const [a] = liveStats(tl, 40, 'netWorth', 'perMin', 'match')
    expect(a.value).toBe(100)
  })

  it('does not count a pause as time played', () => {
    const paused = timeline(
      600,
      [(f) => Math.max(0, f - 30) * 10, () => 0],
      [
        { t: 0, game: -30, paused: false },
        { t: 150, game: 120, paused: true },
        { t: 210, game: 120, paused: false },
      ],
    )
    // 390s into the recording is 5:00 of play; souls kept accruing in this made-up data
    // through the pause, 3600 in all, so the rate is 3600 over five minutes.
    const [a] = liveStats(paused, 390, 'netWorth', 'perMin', 'match')
    expect(a.value).toBeCloseTo(3600 / 5)
  })

  it('ranks highest first', () => {
    const rows = liveStats(tl, 330, 'netWorth', 'total', 'recent')
    expect(ranked(rows).map((r) => r.player)).toEqual([0, 1])
  })
})
