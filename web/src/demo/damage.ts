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

export type Share<T> = { key: string; of: T; amount: number; hits: number }

/** One direction of a player's damage: everything they dealt, or everything they took. */
export type Side = {
  total: number
  hits: number
  /** Who it was dealt to, or taken from, largest first. */
  byParty: Share<Party>[]
  /** What it came from -- an index into `Events.sources`, -1 for none -- largest first. */
  bySource: Share<number>[]
}

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

function tally<T>(shares: Map<string, Share<T>>, key: string, of: T, amount: number) {
  const share = shares.get(key)
  if (share) {
    share.amount += amount
    share.hits++
  } else {
    shares.set(key, { key, of, amount, hits: 1 })
  }
}

function largestFirst<T>(shares: Map<string, Share<T>>) {
  return [...shares.values()].sort((a, b) => b.amount - a.amount)
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
  const { hz, kinds, damage: d } = timeline.events
  const mine = index[player] ?? []
  const ticks = mine.map((i) => d.t[i])
  const start = lowerBound(ticks, from * hz)
  const end = lowerBound(ticks, Math.floor(to * hz) + 1)

  const sides = {
    dealt: {
      total: 0,
      hits: 0,
      parties: new Map<string, Share<Party>>(),
      sources: new Map<string, Share<number>>(),
    },
    taken: {
      total: 0,
      hits: 0,
      parties: new Map<string, Share<Party>>(),
      sources: new Map<string, Share<number>>(),
    },
  }
  const recent: Hit[] = []

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
    tally(side.parties, partyKey(other), other, amount)
    tally(side.sources, String(d.source[i]), d.source[i], amount)
    if (recent.length < recentCount) {
      recent.push({ id: i, seconds: d.t[i] / hz, dealt, other, amount, source: d.source[i] })
    }
  }

  const finish = (side: (typeof sides)['dealt']): Side => ({
    total: side.total,
    hits: side.hits,
    byParty: largestFirst(side.parties),
    bySource: largestFirst(side.sources),
  })
  return { dealt: finish(sides.dealt), taken: finish(sides.taken), recent }
}
