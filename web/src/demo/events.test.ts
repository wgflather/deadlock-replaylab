import { describe, expect, it } from 'vitest'
import { castsAt, firingAt, killFeed, killsAt, lingerFor, lowerBound, recent } from './events'
import type { Timeline } from './types'

/** A timeline with only what the event readers touch: two players, a 64 Hz event
 * clock and a 1 Hz position stream so positions are easy to place by hand. */
function timeline(over: Partial<Timeline['events']> = {}): Timeline {
  return {
    players: [
      { slot: 0, steamId: '0', name: 'a', heroId: 1, team: 2, rank: 0 },
      { slot: 1, steamId: '1', name: 'b', heroId: 2, team: 3, rank: 0 },
    ],
    positions: {
      hz: 1,
      quant: 16,
      frames: 3,
      x: [
        [0, 10, 20],
        [100, 110, 120],
      ],
      y: [
        [0, 0, 0],
        [5, 5, 5],
      ],
    },
    events: {
      hz: 64,
      quant: 16,
      abilities: ['synth_barrage', 'upgrade_warp_stone'],
      kills: { t: [], victim: [], killer: [], cause: [], assisters: [], x: [], y: [] },
      casts: { t: [], player: [], ability: [], x: [], y: [] },
      firing: [[], []],
      damage: { t: [], from: [], fromKind: [], to: [], toKind: [], amount: [], source: [] },
      kinds: ['hero', 'trooper'],
      sources: [],
      ...over,
    },
  } as unknown as Timeline
}

describe('lowerBound', () => {
  it('finds the first tick at or after the target', () => {
    expect(lowerBound([10, 20, 20, 30], 20)).toBe(1)
    expect(lowerBound([10, 20, 30], 25)).toBe(2)
    expect(lowerBound([10, 20, 30], 99)).toBe(3)
    expect(lowerBound([], 5)).toBe(0)
  })
})

describe('recent', () => {
  const ticks = [64, 128, 192, 640]
  it('includes an event exactly on the playhead', () => {
    expect(recent(ticks, 64, 2, 0.5)).toEqual([1])
  })
  it('excludes events not yet happened and ones older than the window', () => {
    expect(recent(ticks, 64, 3.5, 2)).toEqual([1, 2])
  })
  it('is empty before the first event, so scrubbing back clears the map', () => {
    expect(recent(ticks, 64, 0.5, 5)).toEqual([])
  })
})

describe('lingerFor', () => {
  it('scales with speed so an event stays up for the same screen time', () => {
    expect(lingerFor(1.5, 1)).toBe(1.5)
    expect(lingerFor(1.5, 8)).toBe(12)
  })
})

describe('killsAt', () => {
  const tl = timeline({
    kills: {
      t: [64, 128, 192],
      victim: [1, 0, 1],
      killer: [0, -1, 0],
      cause: ['hero', 'trooper', 'hero'],
      assisters: [[], [], []],
      x: [110, 20, 0],
      y: [5, 0, 0],
    },
  })

  it('places the victim in world units, with its age', () => {
    const [kill] = killsAt(tl, 1.5, 1)
    expect(kill).toMatchObject({ id: 0, victim: 1, killer: 0, x: 1760, y: 80, age: 0.5 })
  })

  it('feeds the latest kills newest first, capped', () => {
    expect(killFeed(tl, 3, 5, 2).map((k) => k.id)).toEqual([2, 1])
    expect(killFeed(tl, 3, 1.5, 6).map((k) => k.id)).toEqual([2, 1])
  })
})

describe('castsAt', () => {
  it('keeps only the latest cast per player, and marks item actives', () => {
    const tl = timeline({
      casts: { t: [64, 96, 100], player: [0, 0, 1], ability: [0, 1, 0], x: [], y: [] },
    })
    const casts = castsAt(tl, 2, 2)
    expect(casts).toHaveLength(2)
    expect(casts.find((c) => c.player === 0)).toMatchObject({ id: 1, item: true })
    expect(casts.find((c) => c.player === 1)).toMatchObject({ ability: 'synth_barrage' })
  })
})

describe('firingAt', () => {
  const tl = timeline({ firing: [[64, 128, 320, 320], []] })

  it('is on inside a burst and for the tail after it', () => {
    expect(firingAt(tl, 1.5, 0.25)).toEqual([true, false])
    expect(firingAt(tl, 2.2, 0.25)).toEqual([true, false])
    expect(firingAt(tl, 2.3, 0.25)).toEqual([false, false])
  })

  it('shows a lone shot for the tail, and nothing before the first', () => {
    expect(firingAt(tl, 5.1, 0.25)).toEqual([true, false])
    expect(firingAt(tl, 0.5, 0.25)).toEqual([false, false])
  })
})
