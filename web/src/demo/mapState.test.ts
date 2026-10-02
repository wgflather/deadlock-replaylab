import { describe, expect, it } from 'vitest'
import type { CampSite } from '../map/camps'
import {
  breakableSpots,
  breakablesAt,
  breaksBy,
  campHistories,
  campSites,
  campsAt,
  midBossAt,
  powerupsAt,
  respawnDelays,
  riftAt,
  urnAt,
  type CampHistory,
} from './mapState'
import type { Timeline } from './types'

const HZ = 64
const s = (seconds: number) => seconds * HZ

function timeline(over: Partial<Timeline['events']> = {}, midBossHp: number[] = []): Timeline {
  return {
    sampleSeconds: 1,
    frames: Math.max(midBossHp.length, 1),
    objectives: {
      quant: 16,
      list: midBossHp.length
        ? [{ kind: 'midBoss', team: 4, x: 0, y: 0, hp: midBossHp, maxHp: midBossHp.map(() => 100) }]
        : [],
    },
    events: {
      hz: HZ,
      quant: 16,
      neutrals: { t: [], x: [], y: [], died: [], tier: [] },
      camps: { x: [], y: [] },
      urn: { t: [], kind: [], player: [], x: [], y: [] },
      rifts: { t: [], open: [], x: [], y: [], contested: [], end: [], outcome: [], team: [] },
      midBossKills: { t: [], player: [] },
      crates: { t: [], x: [], y: [], broken: [], by: [] },
      sinners: { t: [], x: [], y: [], broken: [], by: [] },
      statues: { t: [], x: [], y: [], broken: [], by: [] },
      snacks: { t: [], x: [], y: [], broken: [], by: [] },
      powerups: { t: [], x: [], y: [], broken: [], by: [], kind: [] },
      ...over,
    },
  } as unknown as Timeline
}

const SITES: CampSite[] = [
  { name: 'Drug Store', side: 'amber', tier: 1, x: 1600, y: 0 },
  { name: 'Factory', side: 'amber', tier: 2, x: -1600, y: 0 },
]

describe('campHistories', () => {
  it('gives each creep to the nearest named camp, grouped into waves', () => {
    // Two creeps at the Drug Store at 150s, both seen dying; one at 300s, unseen; one
    // far from everything, which belongs to no camp.
    const tl = timeline({
      neutrals: {
        t: [s(150), s(151), s(300), s(160)],
        x: [100, 98, 101, 900],
        y: [0, 2, 1, 900],
        died: [s(200), s(210), -1, -1],
        tier: [1, 1, 1, 1],
      },
    })
    const [drugStore, factory] = campHistories(tl, SITES)
    expect(drugStore).toMatchObject({ name: 'Drug Store', spawns: [150, 300], clears: [210, null] })
    expect(factory.spawns).toEqual([])
  })
})

describe('campSites', () => {
  it('falls back on the named camps when the replay lists none', () => {
    expect(campSites(timeline()).length).toBeGreaterThan(30)
  })

  it("uses the replay's camps, tiered by their strongest creep, dropping empty ones", () => {
    // Three spots (in 16-unit steps): north, south, and one nothing spawned at.
    const tl = timeline({
      camps: { x: [0, 100, 300], y: [200, -200, 0] },
      neutrals: {
        t: [s(300), s(300), s(300), s(120)],
        x: [2, -2, 0, 101],
        y: [201, 199, 200, -200],
        died: [-1, -1, -1, -1],
        tier: [2, 3, 2, 1],
      },
    })
    expect(campSites(tl)).toEqual([
      { name: 'Sapphire camp', side: 'sapphire', tier: 3, x: 0, y: 3200 },
      { name: 'Amber camp', side: 'amber', tier: 1, x: 1600, y: -3200 },
    ])
  })
})

describe('respawnDelays', () => {
  it('takes the median seen clear-to-spawn delay per tier, and defaults the rest', () => {
    const camps = [
      { ...SITES[0], spawns: [150, 300, 500], clears: [215, 410, null] },
      { ...SITES[0], spawns: [150, 400], clears: [310, null] },
    ] as CampHistory[]
    expect(respawnDelays(camps)).toMatchObject({ 1: 90, 2: 290, 3: 320 })
  })
})

describe('campsAt', () => {
  const camps = [
    // Cleared at 200 (seen), back at 285.
    { ...SITES[0], spawns: [150, 285], clears: [200, null] },
    // Clear unseen: inferred as the next spawn less the tier's delay.
    { ...SITES[0], spawns: [150, 400], clears: [null, null] },
  ] as CampHistory[]
  const delays = { 1: 85, 2: 290, 3: 320 }

  it('is down before its first spawn, with that spawn as next', () => {
    expect(campsAt(camps, 100, delays)[0]).toMatchObject({
      up: false,
      nextSpawn: 150,
      name: 'Drug Store',
    })
  })

  it('is up after spawning and down once cleared, with the next spawn', () => {
    expect(campsAt(camps, 190, delays)[0]).toMatchObject({ up: true, nextSpawn: null })
    expect(campsAt(camps, 250, delays)[0]).toMatchObject({ up: false, nextSpawn: 285 })
  })

  it('infers an unseen clear from the next spawn', () => {
    expect(campsAt(camps, 300, delays)[1].up).toBe(true)
    expect(campsAt(camps, 320, delays)[1]).toMatchObject({ up: false, nextSpawn: 400 })
  })

  it('stays up after its last spawn when no clear was seen', () => {
    expect(campsAt(camps, 1000, delays)[1].up).toBe(true)
  })
})

describe('urnAt', () => {
  const tl = timeline({
    urn: {
      t: [s(630), s(640), s(670), s(930)],
      kind: ['spawn', 'pickup', 'deliver', 'spawn'],
      player: [-1, 3, 3, -1],
      x: [-411, 0, 0, 411],
      y: [0, 0, 0, 0],
    },
  })

  it('walks the Urn from waiting to delivered and back', () => {
    expect(urnAt(tl, 100)).toEqual({ state: 'waiting', nextSpawn: 630 })
    expect(urnAt(tl, 635)).toMatchObject({ state: 'onMap', x: -6576 })
    expect(urnAt(tl, 700)).toEqual({ state: 'delivered', player: 3, at: 670, nextSpawn: 930 })
  })

  it('sends a carried Urn to the side it did not spawn on', () => {
    expect(urnAt(tl, 650)).toEqual({
      state: 'carried',
      player: 3,
      since: 640,
      destination: { x: 6576, y: 0 },
    })
  })
})

describe('riftAt', () => {
  // Taken by Amber, then spilled after a full contest, then still open at the end.
  const tl = timeline({
    rifts: {
      t: [s(800), s(1200), s(1600)],
      open: [s(820), s(1220), s(1620)],
      x: [-473, 476, -473],
      y: [0, 0, 0],
      contested: [s(825), s(1230), -1],
      end: [s(850), s(1290), -1],
      outcome: ['captured', 'released', 'open'],
      team: [2, -1, -1],
    },
  })

  it('walks a Rift from announced to taken', () => {
    expect(riftAt(tl, 100)).toMatchObject({ state: 'none', next: 800 })
    expect(riftAt(tl, 810)).toMatchObject({ state: 'announced', x: -7568, opensAt: 820 })
    expect(riftAt(tl, 822)).toMatchObject({ state: 'open', since: 820, contested: false })
    expect(riftAt(tl, 830)).toMatchObject({ state: 'open', contested: true })
    expect(riftAt(tl, 900)).toMatchObject({ state: 'over', outcome: 'captured', team: 2, next: 1200 })
  })

  it('counts the Rifts each team has taken so far', () => {
    expect(riftAt(tl, 840).taken.get(2)).toBeUndefined()
    expect(riftAt(tl, 900).taken.get(2)).toBe(1)
  })

  it('tells a spilled Rift from a taken one, and one the match ended on', () => {
    expect(riftAt(tl, 1300)).toMatchObject({ state: 'over', outcome: 'released', team: -1 })
    expect(riftAt(tl, 5000)).toMatchObject({ state: 'open', since: 1620 })
  })
})

describe('midBossAt', () => {
  const tl = timeline({ midBossKills: { t: [s(3)], player: [5] } }, [0, 100, 50, 0, 0, 100])

  it('is up with its health, then down with its killer and next spawn', () => {
    expect(midBossAt(tl, 2)).toEqual({ state: 'up', hpFraction: 0.5 })
    expect(midBossAt(tl, 3)).toEqual({ state: 'down', killedAt: 3, killer: 5, nextSpawn: 5 })
    expect(midBossAt(tl, 0)).toMatchObject({ state: 'down', killedAt: null, nextSpawn: 1 })
  })
})

describe('breakablesAt', () => {
  // One spot: spawned at 10s, broken at 20s by player 2, back at 50s. Another spot,
  // spawned at 30s and never broken.
  const list = {
    t: [s(10), s(30), s(50)],
    x: [1, 7, 1],
    y: [2, 8, 2],
    broken: [s(20), -1, -1],
    by: [2, -1, -1],
  }
  const spots = breakableSpots(list)

  it('groups lives by spot', () => {
    expect(spots.map((spot) => spot.lives)).toEqual([[0, 2], [1]])
  })

  it('is standing between spawn and break, and says when it comes back', () => {
    const at = (seconds: number) => breakablesAt(list, spots, HZ, 16, seconds)
    expect(at(5)[0]).toMatchObject({ standing: false, x: 16, y: 32 })
    expect(at(15)[0]).toMatchObject({ standing: true, nextSpawn: null })
    expect(at(25)[0]).toMatchObject({ standing: false, nextSpawn: 50 })
    expect(at(60)[0].standing).toBe(true)
    expect(at(60)[1].standing).toBe(true)
  })

  it('credits breaks to their player up to the playhead', () => {
    const tl = timeline({ crates: list })
    expect(breaksBy(tl, 2, 15)).toEqual([])
    expect(breaksBy(tl, 2, 25)).toEqual([{ seconds: 20, kind: 'crate' }])
  })
})

describe('statues', () => {
  it('credits statue breaks like crates', () => {
    const tl = timeline({
      statues: { t: [s(180)], x: [1], y: [1], broken: [s(200)], by: [4] },
    })
    expect(breaksBy(tl, 4, 250)).toEqual([{ seconds: 200, kind: 'statue' }])
  })
})

describe('snacks', () => {
  it('credits eaten snacks, and counts a respawned one as standing again', () => {
    // One spot: eaten at 300s by player 1, back 180s later and never eaten again.
    const tl = timeline({
      snacks: { t: [s(150), s(480)], x: [5, 5], y: [5, 5], broken: [s(300), -1], by: [1, -1] },
    })
    expect(breaksBy(tl, 1, 400)).toEqual([{ seconds: 300, kind: 'snack' }])
    const spots = breakableSpots(tl.events.snacks)
    expect(breakablesAt(tl.events.snacks, spots, HZ, 16, 400)[0]).toMatchObject({
      standing: false,
      nextSpawn: 480,
    })
    expect(breakablesAt(tl.events.snacks, spots, HZ, 16, 500)[0].standing).toBe(true)
  })
})

describe('powerups', () => {
  it('shows which kind stands at a spot, and credits the hero who took it', () => {
    // One spawner: a gun powerup at 300s taken by player 2 at 320s, a casting one at 600s.
    const tl = timeline({
      powerups: {
        t: [s(300), s(600)],
        x: [-246, -246],
        y: [9, 9],
        broken: [s(320), -1],
        by: [2, -1],
        kind: ['gun', 'casting'],
      },
    })
    const { powerups } = tl.events
    const spots = breakableSpots(powerups)
    expect(powerupsAt(powerups, spots, HZ, 16, 310)[0]).toMatchObject({ standing: true, kind: 'gun' })
    expect(powerupsAt(powerups, spots, HZ, 16, 400)[0]).toMatchObject({
      standing: false,
      kind: null,
      nextSpawn: 600,
    })
    expect(powerupsAt(powerups, spots, HZ, 16, 700)[0].kind).toBe('casting')
    expect(breaksBy(tl, 2, 400)).toEqual([{ seconds: 320, kind: 'powerup', powerup: 'gun' }])
  })
})
