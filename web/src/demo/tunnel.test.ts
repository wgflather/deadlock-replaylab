import { describe, expect, it } from 'vitest'
import { inRuns, spotsAt, type Timeline } from './types'

describe('inRuns', () => {
  it('is true inside a run, end exclusive, and false without runs', () => {
    const runs = [10, 20, 30, 31]
    expect(inRuns(runs, 9)).toBe(false)
    expect(inRuns(runs, 10)).toBe(true)
    expect(inRuns(runs, 19)).toBe(true)
    expect(inRuns(runs, 20)).toBe(false)
    expect(inRuns(runs, 30)).toBe(true)
    expect(inRuns(runs, 31)).toBe(false)
    expect(inRuns(undefined, 15)).toBe(false)
    expect(inRuns([], 15)).toBe(false)
  })
})

describe('spotsAt below ground', () => {
  // One player standing in the Mid-Boss's pit (0, 0, -768) for two frames, the second
  // of them inside a tunnel volume.
  const timeline = (build: number) =>
    ({
      build,
      players: [{ slot: 1 }],
      positions: {
        hz: 1,
        quant: 16,
        frames: 2,
        x: [[0, 0]],
        y: [[0, 0]],
        z: [[-48, -48]],
        cut: [[0, 0]],
        hp: [[100, 100]],
        maxHp: [[100, 100]],
        yaw: [[0, 0]],
        tunnel: [[1, 2]],
      },
    }) as unknown as Timeline

  it('tells underground from tunnels on the current map', () => {
    expect(spotsAt(timeline(10932), 0)[0].below).toBe('underground')
  })

  it("tells them apart on the old map too, against its own rooms", () => {
    expect(spotsAt(timeline(10854), 0)[0].below).toBe('underground')
  })
})

describe('spotsAt under the middle, on the old map', () => {
  it("uses the old map's own rooms", () => {
    // The pit is in both; a side room only in the old one (from a pre-patch replay).
    const old = (x: number, y: number) =>
      ({
        build: 10854,
        players: [{ slot: 1 }],
        positions: {
          hz: 1,
          quant: 16,
          frames: 1,
          x: [[x / 16]],
          y: [[y / 16]],
          z: [[-6]],
          cut: [[0]],
          hp: [[100]],
          maxHp: [[100]],
          yaw: [[0]],
          tunnel: [[]],
        },
      }) as unknown as Timeline
    expect(spotsAt(old(0, 0), 0)[0].below).toBe('underground')
    expect(spotsAt(old(-5008, -1792), 0)[0].below).toBe('underground')
  })
})
