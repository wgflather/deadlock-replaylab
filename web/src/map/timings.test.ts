import { describe, expect, it } from 'vitest'
import { campHistories, urnAt } from '../demo/mapState'
import { timingRules, timingsMatch } from './timings'

describe('timingsMatch', () => {
  it('drops powerups at both spots every five minutes from 5:00', () => {
    const { powerups, hz } = timingsMatch('current').events
    const drops = [...new Set(powerups.t.map((t) => t / hz))]
    expect(drops.slice(0, 3)).toEqual([300, 600, 900])
    expect(powerups.t.length).toBe(drops.length * 2)
  })

  it('sends the Urn west at 10:00, then alternates', () => {
    const match = timingsMatch('current')
    const sides = [610, 910, 1210].map((s) => {
      const urn = urnAt(match, s)
      return urn.state === 'onMap' ? (urn.x < 0 ? 'west' : 'east') : urn.state
    })
    expect(sides).toEqual(['west', 'east', 'west'])
  })

  it('puts up every camp at its tier time, on both maps', () => {
    for (const version of ['current', 'legacy'] as const) {
      const camps = campHistories(timingsMatch(version))
      expect(camps.length).toBeGreaterThan(30)
      for (const camp of camps) expect(camp.spawns).toEqual([{ 1: 120, 2: 300, 3: 480 }[camp.tier]])
    }
  })

  it("lists only what each map has", () => {
    const ids = (v: 'current' | 'legacy') => timingRules(v).map((r) => r.id)
    expect(ids('current')).toEqual(expect.arrayContaining(['snacks', 'toughCrates', 'broker']))
    expect(ids('legacy')).not.toEqual(expect.arrayContaining(['snacks']))
    expect(ids('legacy')).not.toContain('broker')
  })
})

describe('timingsMatch, cycling', () => {
  it('takes each camp as it appears and brings it back after its tier delay', () => {
    const camps = campHistories(timingsMatch('current', true))
    const tier1 = camps.find((c) => c.tier === 1)!
    // 2:00, then 1:25 after each clear, 5 s after it appeared.
    expect(tier1.spawns.slice(0, 3)).toEqual([120, 210, 300])
    expect(tier1.clears[0]).toBe(125)
  })

  it('kills the Mid-Boss at 10:00 and brings it back after 7:00, then 6:00', () => {
    const match = timingsMatch('current', true)
    const boss = match.objectives.list.find((o) => o.kind === 'midBoss')!
    expect(boss.hp[599]).toBeGreaterThan(0)
    expect(boss.hp[600]).toBe(0)
    expect(boss.hp[1019]).toBe(0)
    expect(boss.hp[1020]).toBeGreaterThan(0)
    expect(match.events.midBossKills.t.map((t) => t / 64).slice(0, 3)).toEqual([600, 1025, 1390])
  })

  it('leaves everything standing without cycling', () => {
    const match = timingsMatch('current')
    expect(match.events.statues.broken.every((b) => b === -1)).toBe(true)
    expect(match.events.midBossKills.t).toEqual([])
  })
})
