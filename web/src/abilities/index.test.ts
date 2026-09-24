import { describe, expect, it } from 'vitest'
import { abilityIcon, abilityName, sourceOf } from '.'

describe('abilityName', () => {
  it('uses the game name, which can be nothing like the class name', () => {
    expect(abilityName('ability_unicorn_luminousstrike')).toBe('Radiant Daggers')
    expect(abilityName('upgrade_warp_stone')).toBe('Warp Stone')
  })

  it('falls back to a readable form of an unknown class name', () => {
    expect(abilityName('citadel_ability_brand_new_thing')).toBe('Brand New Thing')
  })
})

describe('abilityIcon', () => {
  it('finds an icon by class name', () => {
    expect(abilityIcon('synth_barrage')).toBeTruthy()
    expect(abilityIcon('no_such_ability')).toBeUndefined()
  })
})

describe('sourceOf', () => {
  it('names a damage source by its deadlock-api id', () => {
    expect(sourceOf(3383556212)).toMatchObject({ kind: 'weapon', name: 'The Black Sheep' })
  })

  it('calls an unnamed hero gun a weapon', () => {
    expect(sourceOf(1895060499)).toMatchObject({ kind: 'weapon', name: 'Weapon' })
  })

  it('is undefined for an id it does not know', () => {
    expect(sourceOf(1)).toBeUndefined()
  })
})
