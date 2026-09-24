import { describe, expect, it } from 'vitest'
import { damageIndex, damageSummary } from './damage'
import type { Timeline } from './types'

/** Three players and a 64 Hz clock. Player 0 shoots player 1 twice and a trooper once,
 * then player 1 hits back; player 2 only takes a Guardian's shot. */
const timeline = {
  players: [{ team: 2 }, { team: 3 }, { team: 3 }],
  events: {
    hz: 64,
    kinds: ['hero', 'trooper', 'neutral', 'guardian'],
    sources: [111, 222],
    damage: {
      t: [64, 128, 192, 256, 320],
      from: [0, 0, 0, 1, -1],
      fromKind: [0, 0, 0, 0, 3],
      to: [1, 1, -1, 0, 2],
      toKind: [0, 0, 1, 0, 0],
      amount: [10, 20, 5, 7, 100],
      source: [0, 1, 0, 1, -1],
    },
  },
} as unknown as Timeline

const index = damageIndex(timeline)

describe('damageIndex', () => {
  it('lists each hit under both the player who dealt it and the one who took it', () => {
    expect(index).toEqual([[0, 1, 2, 3], [0, 1, 3], [4]])
  })
})

describe('damageSummary', () => {
  it('splits dealt from taken and groups by party and source, largest first', () => {
    const s = damageSummary(timeline, index, 0, 0, 10)
    expect(s.dealt.total).toBe(35)
    expect(s.dealt.byParty.map((p) => [p.key, p.amount])).toEqual([
      ['p1', 30],
      ['trooper', 5],
    ])
    expect(s.dealt.bySource.map((p) => [p.of, p.amount])).toEqual([
      [1, 20],
      [0, 15],
    ])
    expect(s.taken).toMatchObject({ total: 7, hits: 1 })
  })

  it('keeps to the window, inclusive of a hit on its last tick', () => {
    const s = damageSummary(timeline, index, 0, 1.5, 3)
    expect(s.dealt.total).toBe(25)
    expect(s.taken.total).toBe(0)
  })

  it('names a non-hero attacker by its kind', () => {
    const s = damageSummary(timeline, index, 2, 0, 10)
    expect(s.taken.byParty[0]).toMatchObject({ key: 'guardian', amount: 100 })
  })

  it('leaves out hits for nothing', () => {
    const zero = {
      ...timeline,
      events: {
        ...timeline.events,
        damage: { ...timeline.events.damage, amount: [10, 20, 5, 0, 100] },
      },
    } as Timeline
    const s = damageSummary(zero, damageIndex(zero), 0, 0, 10)
    expect(s.taken).toMatchObject({ total: 0, hits: 0 })
    expect(s.recent.map((h) => h.id)).not.toContain(3)
  })

  it('lists recent hits newest first, capped', () => {
    const s = damageSummary(timeline, index, 0, 0, 10, 2)
    expect(s.recent.map((h) => [h.id, h.dealt])).toEqual([
      [3, false],
      [2, true],
    ])
  })
})
