import { describe, expect, it } from 'vitest'
import { buildAt } from './items'
import type { Timeline } from './types'

// Real ids from the manifest: Endurance, and Healing Booster, which is built from it.
const ENDURANCE = 2829638276
const HEALING_BOOSTER = 2566692615
const HIGH_VELOCITY = 3077079169

function timeline(items: [number, number, number, number][]): Timeline {
  return {
    events: {
      hz: 64,
      items: {
        t: items.map((e) => e[0]),
        player: items.map((e) => e[1]),
        id: items.map((e) => e[2]),
        sold: items.map((e) => e[3]),
      },
    },
  } as unknown as Timeline
}

describe('buildAt', () => {
  it('holds what was bought and not sold, up to the playhead', () => {
    const tl = timeline([
      [64, 0, ENDURANCE, 0],
      [128, 1, HIGH_VELOCITY, 0],
      [640, 0, HIGH_VELOCITY, 0],
    ])
    expect(buildAt(tl, 0, 5).held.map((h) => h.id)).toEqual([ENDURANCE])
    expect(buildAt(tl, 0, 10).held.map((h) => [h.id, h.boughtAt])).toEqual([
      [ENDURANCE, 1],
      [HIGH_VELOCITY, 10],
    ])
  })

  it('reads a same-tick sale of a component as an upgrade, whichever comes first', () => {
    for (const order of [
      [
        [320, 0, ENDURANCE, 1],
        [320, 0, HEALING_BOOSTER, 0],
      ],
      [
        [320, 0, HEALING_BOOSTER, 0],
        [320, 0, ENDURANCE, 1],
      ],
    ] as [number, number, number, number][][]) {
      const build = buildAt(timeline([[64, 0, ENDURANCE, 0], ...order]), 0, 10)
      expect(build.held).toEqual([{ id: HEALING_BOOSTER, boughtAt: 5, upgradedFrom: ENDURANCE }])
      expect(build.history.map((e) => e.change)).toEqual(['bought', 'bought', 'consumed'])
    }
  })

  it('calls a sale on its own a sale', () => {
    const tl = timeline([
      [64, 0, HIGH_VELOCITY, 0],
      [320, 0, HIGH_VELOCITY, 1],
    ])
    const build = buildAt(tl, 0, 10)
    expect(build.held).toEqual([])
    expect(build.history.at(-1)).toMatchObject({ id: HIGH_VELOCITY, change: 'sold' })
  })
})
