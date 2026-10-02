import { sourceOf } from '../abilities'
import { lowerBound } from './events'
import type { DamageKind, Timeline } from './types'

/**
 * One player's damage, dealt and taken, over a stretch of the match -- what the
 * inspector's Damage tab shows.
 *
 * A match has tens of thousands of hits, and the inspector asks for a summary several
 * times a second while playing. So the hits are indexed per player once (`damageIndex`)
 * and each summary binary-searches that player's own list to the window, touching only
 * the hits it reports.
 */

/** Every hit's index in `Events.damage`, per player, for hits they dealt or took. In
 * time order, since the damage columns are. */
export type DamageIndex = number[][]

export function damageIndex(timeline: Timeline): DamageIndex {
  const d = timeline.events.damage
  const index: DamageIndex = timeline.players.map(() => [])
  for (let i = 0; i < d.t.length; i++) {
    if (d.from[i] >= 0) index[d.from[i]]?.push(i)
    // Self-damage is listed once, not twice.
    if (d.to[i] >= 0 && d.to[i] !== d.from[i]) index[d.to[i]]?.push(i)
  }
  return index
}

/** The other side of a hit: a player, or a kind of thing that is not one. */
export type Party = { player: number; kind: DamageKind }

/** A key that tells parties apart: each player is their own, every trooper is one. */
function partyKey(party: Party) {
  return party.player >= 0 ? `p${party.player}` : party.kind
}

/**
 * The game's three kinds of damage, worked out from what dealt a hit: a hero's gun is
 * gun damage, a melee swing (or a melee item's proc) is melee, and every other ability
 * or item is spirit. An approximation -- a few items deal gun damage on proc -- but the
 * replay's own damage-kind field marks nearly every hit a bullet, so it cannot say better.
 * "other" is a hit that named no source: a trooper's, a neutral's or an objective's.
 */
export type DamageType = 'gun' | 'spirit' | 'melee' | 'other'

export const DAMAGE_TYPES: readonly DamageType[] = ['gun', 'spirit', 'melee', 'other']

/** The kind of damage deadlock-api id `id` deals, or "other" for an unknown one. */
export function damageType(id: number | undefined): DamageType {
  const source = id === undefined ? undefined : sourceOf(id)
  if (!source) return 'other'
  if (source.kind === 'weapon') return 'gun'
  if (/(^|_)melee_/.test(source.className)) return 'melee'
  return 'spirit'
}

export type Share<T> = {
  key: string
  of: T
  amount: number
  hits: number
  /** How much of `amount` was each kind of damage. */
  byType: Record<DamageType, number>
}

/** A share broken down one level further: a party into the sources the damage came
 * from, or a source into the parties it was between. `parts` are largest first. */
export type Group<T, U> = Share<T> & { parts: Share<U>[] }

/** One direction of a player's damage: everything they dealt, or everything they took. */
export type Side = {
  total: number
  hits: number
  /** Who it was dealt to, or taken from, largest first, each split by what it came from:
   * an index into `Events.sources`, -1 for none. */
  byParty: Group<Party, number>[]
  /** The same damage by what it came from, largest first, each split by party. */
  bySource: Group<number, Party>[]
  /** The part of `total` between heroes, and the part with troopers, neutrals and
   * objectives: kept apart so farming and pushing do not drown out the fights. */
  heroes: TypeSplit
  world: TypeSplit
}

/** An amount of damage and how much of it was each kind. */
export type TypeSplit = { total: number; byType: Record<DamageType, number> }

const emptySplit = (): TypeSplit => ({
  total: 0,
  byType: { gun: 0, spirit: 0, melee: 0, other: 0 },
})

export type Hit = {
  /** Index into `Events.damage`: stable, so a React key. */
  id: number
  seconds: number
  /** True for a hit this player dealt, false for one they took. */
  dealt: boolean
  other: Party
  amount: number
  source: number
}

export type DamageSummary = { dealt: Side; taken: Side; recent: Hit[] }

/** A group being summed: its own share, and its parts by key. */
type Tally<T, U> = Share<T> & { inner: Map<string, Share<U>> }

function add<T>(share: Share<T>, amount: number, type: DamageType) {
  share.amount += amount
  share.hits++
  share.byType[type] += amount
}

function newShare<T>(key: string, of: T): Share<T> {
  return { key, of, amount: 0, hits: 0, byType: emptySplit().byType }
}

function tally<T, U>(
  groups: Map<string, Tally<T, U>>,
  key: string,
  of: T,
  partKey: string,
  partOf: U,
  amount: number,
  type: DamageType,
) {
  let group = groups.get(key)
  if (!group) {
    group = { ...newShare(key, of), inner: new Map() }
    groups.set(key, group)
  }
  add(group, amount, type)
  let part = group.inner.get(partKey)
  if (!part) {
    part = newShare(partKey, partOf)
    group.inner.set(partKey, part)
  }
  add(part, amount, type)
}

const largestFirst = <T extends { amount: number }>(shares: Iterable<T>) =>
  [...shares].sort((a, b) => b.amount - a.amount)

function finishGroups<T, U>(groups: Map<string, Tally<T, U>>): Group<T, U>[] {
  return largestFirst(groups.values()).map(({ inner, ...share }) => ({
    ...share,
    parts: largestFirst(inner.values()),
  }))
}

/**
 * `player`'s damage from `from` to `to` match seconds, and their last `recentCount` hits
 * in that stretch, newest first.
 */
export function damageSummary(
  timeline: Timeline,
  index: DamageIndex,
  player: number,
  from: number,
  to: number,
  recentCount = 8,
): DamageSummary {
  const { hz, kinds, sources, damage: d } = timeline.events
  const mine = index[player] ?? []
  const ticks = mine.map((i) => d.t[i])
  const start = lowerBound(ticks, from * hz)
  const end = lowerBound(ticks, Math.floor(to * hz) + 1)

  const sides = {
    dealt: {
      total: 0,
      hits: 0,
      parties: new Map<string, Tally<Party, number>>(),
      sources: new Map<string, Tally<number, Party>>(),
      heroes: emptySplit(),
      world: emptySplit(),
    },
    taken: {
      total: 0,
      hits: 0,
      parties: new Map<string, Tally<Party, number>>(),
      sources: new Map<string, Tally<number, Party>>(),
      heroes: emptySplit(),
      world: emptySplit(),
    },
  }
  const recent: Hit[] = []
  const types = sources.map(damageType)

  for (let k = end - 1; k >= start; k--) {
    const i = mine[k]
    // A hit for nothing -- blocked, or absorbed -- is in the replay, but it is not damage.
    if (d.amount[i] <= 0) continue
    const dealt = d.from[i] === player
    const other: Party = dealt
      ? { player: d.to[i], kind: kinds[d.toKind[i]] ?? 'other' }
      : { player: d.from[i], kind: kinds[d.fromKind[i]] ?? 'other' }
    const amount = d.amount[i]
    const side = dealt ? sides.dealt : sides.taken
    side.total += amount
    side.hits++
    const type = types[d.source[i]] ?? 'other'
    const source = d.source[i]
    tally(side.parties, partyKey(other), other, String(source), source, amount, type)
    tally(side.sources, String(source), source, partyKey(other), other, amount, type)
    const split = other.player >= 0 ? side.heroes : side.world
    split.total += amount
    split.byType[type] += amount
    if (recent.length < recentCount) {
      recent.push({ id: i, seconds: d.t[i] / hz, dealt, other, amount, source: d.source[i] })
    }
  }

  const finish = (side: (typeof sides)['dealt']): Side => ({
    total: side.total,
    hits: side.hits,
    byParty: finishGroups(side.parties),
    bySource: finishGroups(side.sources),
    heroes: side.heroes,
    world: side.world,
  })
  return { dealt: finish(sides.dealt), taken: finish(sides.taken), recent }
}
