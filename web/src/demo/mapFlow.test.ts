import { describe, expect, it } from 'vitest'
import { duration, schedule, upcoming } from './mapFlow'
import type { Timeline } from './types'

const HZ = 64
const s = (seconds: number) => seconds * HZ
const none = { t: [], x: [], y: [], broken: [], by: [] }

/** A match with only what a test fills in; clock straight, no pause. */
function timeline(events: Record<string, unknown>, extra: Record<string, unknown> = {}): Timeline {
  return {
    build: 10932,
    clockStart: 0,
    clock: [{ t: 0, game: 0, paused: false }],
    sampleSeconds: 1,
    duration: 2400,
    frames: 2401,
    players: [{ team: 2 }, { team: 3 }],
    creeps: { hz: 8, quant: 16, lives: [] },
    objectives: { quant: 16, list: [] },
    ...extra,
    events: {
      hz: HZ,
      quant: 16,
      neutrals: { t: [], x: [], y: [], died: [], tier: [] },
      camps: { x: [], y: [] },
      urn: { t: [], kind: [], player: [], x: [], y: [] },
      rifts: { t: [], open: [], x: [], y: [], contested: [], end: [], outcome: [], team: [] },
      midBossKills: { t: [], player: [] },
      crates: none,
      sinners: none,
      statues: none,
      snacks: none,
      toughCrates: none,
      bells: none,
      broker: { t: [], limit: [] },
      powerups: { ...none, kind: [] },
      ...events,
    },
  } as unknown as Timeline
}

describe('duration', () => {
  it('writes seconds the way the game clock does', () => {
    expect(duration(0)).toBe('0:00')
    expect(duration(85)).toBe('1:25')
    expect(duration(300.4)).toBe('5:00')
  })
})

describe('schedule', () => {
  it('measures when things first came and how often, from the match itself', () => {
    const tl = timeline({
      powerups: {
        t: [s(300), s(300), s(600), s(600), s(900), s(900)],
        x: [-246, 246, -246, 246, -246, 246],
        y: [9, -8, 9, -8, 9, -8],
        broken: [-1, -1, -1, -1, -1, -1],
        by: [-1, -1, -1, -1, -1, -1],
        kind: ['gun', 'casting', 'gun', 'casting', 'gun', 'casting'],
      },
      statues: { t: [s(180), s(500)], x: [1, 1], y: [1, 1], broken: [s(320)], by: [0] },
      broker: { t: [s(1834)], limit: [1] },
    })
    const rows = Object.fromEntries(schedule(tl).map((r) => [r.id, r]))
    expect(rows.powerups).toMatchObject({ first: 300, again: 'every 5:00' })
    expect(rows.statues).toMatchObject({ first: 180, again: '3:00 after broken' })
    expect(rows.broker).toMatchObject({ first: 1834 })
  })
})

describe('upcoming', () => {
  it('lists what is due next, soonest first, one of each kind', () => {
    const tl = timeline({
      urn: {
        t: [s(600), s(900), s(1200)],
        kind: ['spawn', 'spawn', 'spawn'],
        player: [-1, -1, -1],
        x: [-412, 412, -412],
        y: [0, 0, 0],
      },
      powerups: { t: [s(900)], x: [1], y: [1], broken: [-1], by: [-1], kind: ['gun'] },
    })
    expect(upcoming(tl, 700).map((u) => [u.at, u.label])).toEqual([
      [900, 'Powerups drop'],
      [900, 'Urn (east)'],
    ])
  })
})
