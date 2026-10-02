import { describe, expect, it } from 'vitest'
import { damageIndex, damageSummary, damageType } from './damage'
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
    expect(s.taken).toMatchObject({ total: 7, hits: 1 })
  })

  it('splits each party by source, and each source by party', () => {
    const s = damageSummary(timeline, index, 0, 0, 10)
    expect(s.dealt.byParty[0].parts.map((p) => [p.of, p.amount])).toEqual([
      [1, 20],
      [0, 10],
    ])
    expect(s.dealt.bySource.map((p) => [p.of, p.amount])).toEqual([
      [1, 20],
      [0, 15],
    ])
    expect(s.dealt.bySource[1].parts.map((p) => [p.key, p.amount])).toEqual([
      ['p1', 10],
      ['trooper', 5],
    ])
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

  it('splits each party and its sources by kind of damage', () => {
    const s = damageSummary(timeline, index, 2, 0, 10)
    const split = { gun: 0, spirit: 0, melee: 0, other: 100 }
    expect(s.taken.byParty[0].byType).toEqual(split)
    expect(s.taken.byParty[0].parts[0].byType).toEqual(split)
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

describe('damageType', () => {
  it('tells gun, melee and spirit damage apart by source', () => {
    expect(damageType(2679155647)).toBe('gun') // citadel_weapon_haze_set
    expect(damageType(3104292528)).toBe('melee') // ability_melee_haze
    expect(damageType(11664367)).toBe('melee') // citadel_ability_melee_shiv
    expect(damageType(26002154)).toBe('melee') // upgrade_melee_charge
    expect(damageType(10116178)).toBe('spirit') // an ability
    expect(damageType(undefined)).toBe('other')
    expect(damageType(111)).toBe('other')
  })

  it('sums a side by type, hero damage apart from the rest', () => {
    const typed = {
      ...timeline,
      events: { ...timeline.events, sources: [2679155647, 3104292528] },
    } as Timeline
    const s = damageSummary(typed, damageIndex(typed), 0, 0, 10)
    expect(s.dealt.heroes).toEqual({
      total: 30,
      byType: { gun: 10, spirit: 0, melee: 20, other: 0 },
    })
    expect(s.dealt.world).toEqual({
      total: 5,
      byType: { gun: 5, spirit: 0, melee: 0, other: 0 },
    })
    const guardian = damageSummary(typed, damageIndex(typed), 2, 0, 10).taken
    expect(guardian.heroes.total).toBe(0)
    expect(guardian.world).toMatchObject({ total: 100, byType: { other: 100 } })
  })
})
