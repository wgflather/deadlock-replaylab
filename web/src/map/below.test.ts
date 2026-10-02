import { describe, expect, it } from 'vitest'
import { belowAt, isUnderground } from './below'

describe('belowAt', () => {
  it("knows the Mid-Boss's pit is under the middle, and a sewer or a street is not", () => {
    expect(isUnderground(0, 0)).toBe(true)
    expect(belowAt(0, 0, -768, false)).toBe('underground')
    // The street over the same footprint is not below anything.
    expect(belowAt(0, 0, 300, false)).toBe(null)
    // Along the south mid-sewer, where a hero was seen running it end to end.
    expect(belowAt(0, -1580, 128, true)).toBe('tunnels')
    // Out in the north base, nowhere near anything below ground.
    expect(isUnderground(0, 9000)).toBe(false)
  })
})
