import { describe, expect, it } from 'vitest'
import { rankLabel } from './rank'

describe('rankLabel', () => {
  it('names the tier and subtier', () => {
    expect(rankLabel(116)).toBe('Eternus 6')
    expect(rankLabel(105)).toBe('Ascendant 5')
    expect(rankLabel(11)).toBe('Initiate 1')
  })

  it('shows nothing for an unranked or unknown badge', () => {
    expect(rankLabel(0)).toBeNull()
    expect(rankLabel(120)).toBeNull()
    expect(rankLabel(107)).toBeNull()
  })
})
