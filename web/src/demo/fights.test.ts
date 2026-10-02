import { describe, expect, it } from 'vitest'
import { fightLabel, findFights } from './fights'
import type { Timeline } from './types'

const HZ = 64
const FRAMES = 8 * 200

/** Six a side: players 0-5 Amber, 6-11 Sapphire, each 1000 health, all standing at the
 * origin unless `at` moves them. `hits` are [seconds, from, to, amount]; `kills` are
 * [seconds, victim, killer]. */
function match(
  hits: [number, number, number, number][],
  kills: [number, number, number][] = [],
  at: Record<number, [number, number]> = {},
  laning = 600,
) {
  const players = Array.from({ length: 12 }, (_, i) => ({ team: i < 6 ? 2 : 3 }))
  const column = (i: number) => Array(FRAMES).fill(i)
  return {
    players,
    // No laning phase unless a test asks for one: the clock reads ten minutes in at once.
    clockStart: -laning,
    positions: {
      hz: 8,
      quant: 16,
      frames: FRAMES,
      x: players.map((_, p) => column(at[p]?.[0] ?? 0)),
      y: players.map((_, p) => column(at[p]?.[1] ?? 0)),
      maxHp: players.map(() => column(1000)),
    },
    events: {
      hz: HZ,
      damage: {
        t: hits.map((h) => h[0] * HZ),
        from: hits.map((h) => h[1]),
        to: hits.map((h) => h[2]),
        amount: hits.map((h) => h[3]),
      },
      kills: {
        t: kills.map((k) => k[0] * HZ),
        victim: kills.map((k) => k[1]),
        killer: kills.map((k) => k[2]),
        assisters: kills.map(() => []),
      },
    },
  } as unknown as Timeline
}

describe('findFights', () => {
  it('finds a 1v1 and who won it', () => {
    const fights = findFights(
      match(
        [
          [10, 0, 6, 400],
          [11, 6, 0, 200],
          [12, 0, 6, 400],
        ],
        [[13, 6, 0]],
      ),
    )
    expect(fights).toHaveLength(1)
    expect(fightLabel(fights[0])).toBe('1v1')
    expect(fights[0]).toMatchObject({ start: 10, end: 13, kind: 'skirmish', winner: 0 })
    expect(fights[0].sides[0]).toMatchObject({ team: 2, players: [0], damage: 800, kills: 1 })
  })

  it('places a fight where its hits landed', () => {
    // Two hits on player 6 at the origin, one on player 0 a hundred steps east.
    const at = { 0: [100, 0] } as Record<number, [number, number]>
    const [fight] = findFights(match([[10, 0, 6, 600], [11, 0, 6, 100], [12, 6, 0, 100]], [], at))
    expect(fight.x).toBeCloseTo(1600 / 3)
    expect(fight.y).toBe(0)
    // Nine in ten of three hits is the second-furthest: one of the two at the origin.
    expect(fight.radius).toBeCloseTo(1600 / 3)
  })

  it('leaves out poke nobody was hurt by', () => {
    // 50 a hit every 4 seconds: half their health in the end, but never at once.
    const poke = Array.from({ length: 12 }, (_, i): [number, number, number, number] => [
      10 + i * 4,
      0,
      6,
      50,
    ])
    expect(findFights(match(poke))).toEqual([])
  })

  it('ends a fight after a quiet gap', () => {
    const fights = findFights(
      match([
        [10, 0, 6, 600],
        [30, 0, 6, 600],
      ]),
    )
    expect(fights.map((f) => f.start)).toEqual([10, 30])
  })

  it('keeps fights between different players apart when far away', () => {
    const hits: [number, number, number, number][] = [
      [10, 0, 6, 600],
      [10, 1, 7, 600],
    ]
    const far = { 1: [1000, 0], 7: [1000, 0] } as Record<number, [number, number]>
    expect(findFights(match(hits, [], far))).toHaveLength(2)
    // Side by side, they are one 2v2.
    const fights = findFights(match(hits))
    expect(fights.map(fightLabel)).toEqual(['2v2'])
  })

  it('calls it a team fight when half of each team is in it', () => {
    const hits: [number, number, number, number][] = [
      [10, 0, 6, 600],
      [10, 1, 7, 100],
      [11, 8, 2, 100],
    ]
    expect(findFights(match(hits))[0]).toMatchObject({ kind: 'teamfight' })
  })

  describe('in the laning phase', () => {
    const lane = (
      hits: [number, number, number, number][],
      kills: [number, number, number][] = [],
      at: Record<number, [number, number]> = {},
    ) => findFights(match(hits, kills, at, 0))

    it('leaves out a trade that took half a health bar, not the three quarters of a near-kill', () => {
      expect(lane([[10, 0, 6, 600]])).toEqual([])
      expect(lane([[10, 0, 6, 800]])).toHaveLength(1)
    })

    it('calls its fights lane fights, and splits poke off them after a shorter gap', () => {
      // A hit every five seconds is one exchange by the later rules, three here: the poke
      // is left out, and the fight starts at the kill's run-up.
      const hits: [number, number, number, number][] = [
        [1, 0, 6, 100],
        [6, 0, 6, 100],
        [11, 0, 6, 100],
        [16, 0, 6, 800],
      ]
      expect(lane(hits, [[17, 6, 0]]).map((f) => [f.start, f.kind])).toEqual([[16, 'lane']])
      expect(findFights(match(hits, [[17, 6, 0]]))[0]).toMatchObject({ start: 1, kind: 'skirmish' })
    })

    it('carries a fight on through a chase longer than the gap', () => {
      const fights = lane(
        [
          [10, 0, 6, 800],
          [10, 1, 7, 100],
          [16, 6, 0, 800],
        ],
        [[17, 0, 6]],
      )
      expect(fights.map((f) => [f.start, f.end, fightLabel(f)])).toEqual([[10, 17, '2v2']])
    })

    it('does not carry a fight on into another across the map', () => {
      const fights = lane(
        [
          [10, 0, 6, 800],
          [16, 6, 1, 800],
        ],
        [],
        { 1: [1000, 0] },
      )
      expect(fights).toHaveLength(2)
    })
  })

  it('adds the killer to the fight their victim fell in', () => {
    const fights = findFights(match([[10, 0, 6, 900]], [[11, 6, 3]]))
    expect(fights[0].sides[0].players).toEqual([0, 3])
  })
})
