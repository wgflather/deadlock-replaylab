import { itemOf } from '../abilities'
import type { Timeline } from './types'

/**
 * A player's items at a moment in the match: what they are holding, and how they got
 * there -- what the inspector's Items tab shows.
 *
 * Rebuilt from the purchase log every time rather than kept current as playback moves.
 * A player buys and sells a few dozen times a match, so replaying their log is cheaper
 * than anything that would have to be kept in step with a scrubber, and scrubbing back
 * is as right as playing forward.
 */

/** An item in hand. */
export type HeldItem = {
  id: number
  /** Match seconds it was bought at. */
  boughtAt: number
  /** The id of the item it was upgraded from, if it consumed one when bought. */
  upgradedFrom: number | null
}

/** One line of the build's history. */
export type ItemEvent = {
  seconds: number
  id: number
  /** "consumed" is a component used up by an upgrade bought on the same tick. */
  change: 'bought' | 'sold' | 'consumed'
}

export type Build = {
  /** Oldest purchase first. */
  held: HeldItem[]
  /** Oldest first. */
  history: ItemEvent[]
}

/** `player`'s items as they stood `seconds` into the match. */
export function buildAt(timeline: Timeline, player: number, seconds: number): Build {
  const { hz, items } = timeline.events
  const now = seconds * hz
  const held = new Map<number, HeldItem>()
  const history: ItemEvent[] = []

  // Walked a tick at a time: an upgrade's purchase and its component's sale share one,
  // in either order, and only seeing both says which sale was really a consumption.
  let i = 0
  while (i < items.t.length && items.t[i] <= now) {
    const tick = items.t[i]
    const bought: number[] = []
    const sold: number[] = []
    for (; i < items.t.length && items.t[i] === tick; i++) {
      if (items.player[i] !== player) continue
      ;(items.sold[i] ? sold : bought).push(items.id[i])
    }

    const consumed = new Set<number>()
    for (const id of bought) {
      const components = itemOf(id)?.components ?? []
      const from = sold.find(
        (s) => !consumed.has(s) && components.includes(itemOf(s)?.className ?? ''),
      )
      if (from !== undefined) consumed.add(from)
      held.set(id, { id, boughtAt: tick / hz, upgradedFrom: from ?? null })
      history.push({ seconds: tick / hz, id, change: 'bought' })
    }
    for (const id of sold) {
      held.delete(id)
      history.push({ seconds: tick / hz, id, change: consumed.has(id) ? 'consumed' : 'sold' })
    }
  }

  return { held: [...held.values()].sort((a, b) => a.boughtAt - b.boughtAt), history }
}
