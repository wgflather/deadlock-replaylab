import { describe, expect, it } from 'vitest'
import {
  lerpAngle,
  objectivesAt,
  pairBaseGuardians,
  type ObjectiveSpot,
  type Timeline,
} from './types'

const spot = (over: Partial<ObjectiveSpot>): ObjectiveSpot => ({
  kind: 'baseGuardian',
  team: 2,
  x: 0,
  y: 0,
  hpFraction: 1,
  destroyed: false,
  lane: 4,
  recentlyDamaged: false,
  ...over,
})

describe('pairBaseGuardians', () => {
  it('folds a pair into one spot at its midpoint with combined health', () => {
    const [pair] = pairBaseGuardians([
      spot({ x: 208, y: -5456, hpFraction: 1 }),
      spot({ x: -208, y: -5456, hpFraction: 0, destroyed: true }),
    ])
    expect(pair).toMatchObject({ x: 0, y: -5456, hpFraction: 0.5, destroyed: false })
  })

  it('reads a pair as destroyed only once both are', () => {
    const [pair] = pairBaseGuardians([
      spot({ x: 1760, y: -6752, hpFraction: 0, destroyed: true }),
      spot({ x: 1760, y: -6400, hpFraction: 0, destroyed: true }),
    ])
    expect(pair.destroyed).toBe(true)
  })

  it('keeps separate pairs, teams and other kinds apart', () => {
    const out = pairBaseGuardians([
      spot({ x: 208, y: -5456 }),
      spot({ x: 1760, y: -6400 }),
      spot({ x: -208, y: -5456 }),
      spot({ x: 1760, y: -6752 }),
      spot({ x: 216, y: -5456, team: 3 }),
      spot({ kind: 'shrine', x: 1584, y: -7536, lane: null }),
    ])
    expect(out.map((s) => [s.kind, s.team, s.x, s.y])).toEqual([
      ['baseGuardian', 2, 0, -5456],
      ['baseGuardian', 2, 1760, -6576],
      ['baseGuardian', 3, 216, -5456],
      ['shrine', 2, 1584, -7536],
    ])
  })
})

describe('recentlyDamaged', () => {
  // A Mid-Boss at full health, hit at 10s and 11s, then left alone at 11000 of 13000.
  const hp = [13000, 13000, 13000, 13000, 13000, 13000, 13000, 13000, 13000, 13000, 12000, 11000]
  while (hp.length < 30) hp.push(11000)
  const timeline = {
    sampleSeconds: 1,
    frames: hp.length,
    objectives: {
      quant: 16,
      list: [{ kind: 'midBoss', team: 4, x: 0, y: 0, hp, maxHp: hp.map(() => 13000) }],
    },
    lanes: { quant: 16, list: [] },
  } as unknown as Timeline
  const at = (s: number) => objectivesAt(timeline, s)[0].recentlyDamaged

  it('is false before anyone attacks', () => expect(at(5)).toBe(false))
  it('is true while health is going down', () => expect(at(10.5)).toBe(true))
  it('lingers for a few seconds after the last hit', () => expect(at(15)).toBe(true))
  it('clears once the fight has moved on, even below full health', () =>
    expect(at(20)).toBe(false))
})

describe('lerpAngle', () => {
  it('turns the short way across 0', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0)
    expect(lerpAngle(10, 350, 0.25)).toBeCloseTo(5)
  })
  it('blends ordinary angles linearly', () => expect(lerpAngle(90, 180, 0.5)).toBeCloseTo(135))
  it('keeps the result in 0..360', () => expect(lerpAngle(355, 20, 1)).toBeCloseTo(20))
})
