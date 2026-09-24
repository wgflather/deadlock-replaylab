import { describe, expect, it } from 'vitest'
import { AMBER, SAPPHIRE } from '../demo/types'
import { laneColour, objectiveColours } from './palette'

describe('objectiveColours', () => {
  it('uses team colours in the neutral view', () => {
    expect(objectiveColours({ kind: 'walker', team: AMBER, lane: 1 }, 'neutral').fill).toBe(
      'var(--data-team-amber)',
    )
    expect(objectiveColours({ kind: 'patron', team: SAPPHIRE, lane: null }, 'neutral').fill).toBe(
      'var(--data-team-sapphire)',
    )
  })

  it("colours your lane structures by their lane, as Lanes.psb does", () => {
    expect(objectiveColours({ kind: 'guardian', team: AMBER, lane: 1 }, AMBER).fill).toBe('#ffdf41')
    expect(objectiveColours({ kind: 'walker', team: AMBER, lane: 4 }, AMBER)).toEqual({
      fill: '#2fc8e6',
      core: '#073a45',
    })
    expect(objectiveColours({ kind: 'baseGuardian', team: AMBER, lane: 6 }, AMBER).fill).toBe(
      '#6cb348',
    )
  })

  it('draws your Shrines and Patron white', () => {
    expect(objectiveColours({ kind: 'shrine', team: SAPPHIRE, lane: null }, SAPPHIRE).fill).toBe(
      '#ffefd7',
    )
    expect(objectiveColours({ kind: 'patron', team: SAPPHIRE, lane: null }, SAPPHIRE).fill).toBe(
      '#ffefd7',
    )
  })

  it('draws every enemy structure red', () => {
    for (const kind of ['guardian', 'walker', 'baseGuardian', 'shrine', 'patron'] as const) {
      expect(objectiveColours({ kind, team: SAPPHIRE, lane: 1 }, AMBER).fill).toBe('#dc4d30')
    }
  })

  it('leaves the Mid-Boss neutral in every view', () => {
    expect(objectiveColours({ kind: 'midBoss', team: 4, lane: null }, AMBER).fill).toBe(
      'var(--data-neutral)',
    )
  })
})

describe('laneColour', () => {
  it('follows the same rules for the zipline', () => {
    expect(laneColour(1, AMBER, 'neutral')).toBe('var(--data-team-amber)')
    expect(laneColour(4, AMBER, AMBER)).toBe('#559bbe')
    expect(laneColour(4, SAPPHIRE, AMBER)).toBe('#8b3726')
  })
})
