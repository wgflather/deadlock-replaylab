import type { Timeline } from './types'
import { recordingSeconds } from './usePlayback'

/**
 * The match's fights: stretches of heroes trading damage with heroes, told apart from
 * one another and sized up -- a 1v1 in a lane, a 2v2 gank, a team fight.
 *
 * Built from hero-on-hero hits alone. A hit joins a fight when its attacker or victim
 * was already trading blows in it within the last `GAP` seconds; a hit that touches two
 * fights merges them. Linking by who is involved, and not by time alone, keeps two
 * fights going at once in different lanes apart -- and fights that overlap in time
 * *and* place are then joined, as one brawl whose halves never happened to hit each
 * other. Kills are placed in the fight their victim was in, and whoever was credited or
 * assisted joins it.
 *
 * The laning phase is judged by its own, stricter rules. For its first minutes heroes
 * stand in their lanes trading chip damage with the pair across from them, all the time;
 * read by the rules for later on, that is one long fight per lane. So there the gap that
 * ends a fight is shorter, and a fight has to have come close to a kill to count.
 */

/** Seconds without a hit between a player and the fight before they are out of it -- and,
 * once nobody is left in it, before it is over. Long enough to span a retreat to heal
 * and a turn back; short enough that the next wave's poke is a fight of its own. */
export const GAP = 8

/** Game-clock seconds of the laning phase, and its shorter gap: in lane, a trade, a step
 * back out of range and another trade are two exchanges, not one fight. */
export const LANING_END = 600
const LANING_GAP = 4

/** Seconds a kill may land after a fight's last hit and still be its kill: burn and
 * bleed finish people off after the fighting has stopped. */
const KILL_GRACE = 3

/** World units between two fights' centres, overlapping in time, within which they are
 * one fight. About the width of a lane's fighting space. */
const NEAR = 2500

/** For an exchange nobody died in to be a fight rather than poke, someone must lose
 * this share of their health within `BURST` seconds. Laning heroes trade chip damage for
 * minutes on end, and over a minute anyone loses half their health; in a fight they lose
 * it at once. */
const HURT = 0.5
const BURST = 10
/** In lane, where a trade taking half someone's health is routine, only a near-kill. */
const LANING_HURT = 0.75
/** Seconds of a lane fight kept before its decisive moment -- the first kill or
 * near-kill. A lane that trades without pause chains for a minute before anything
 * happens; the run-up to the kill is what is worth watching. */
const LANING_LEAD = 10

/** The share of a fight's hits its radius takes in. */
const SPREAD = 0.9

/** A team fight; a smaller fight after laning; or one in the laning phase. */
export type FightKind = 'teamfight' | 'skirmish' | 'lane'

export type Fight = {
  /** Match seconds of the first hit and of the last hit or kill. */
  start: number
  end: number
  /** Who took part, per team: `[team of players[0]'s side, the other]` in `teams` order. */
  sides: [FightSide, FightSide]
  kind: FightKind
  /** Where it happened, in world units: the middle of where its hits landed, and how far
   * from there nine in ten of them did -- the rest are the odd long-range ability. */
  x: number
  y: number
  radius: number
  /** The side that came out ahead -- more kills, or failing that more damage -- as an
   * index into `sides`, or -1 when it was even. */
  winner: number
}

export type FightSide = {
  team: number
  /** Indexes into `Timeline.players`, in index order. */
  players: number[]
  /** Hero damage this side dealt in the fight. */
  damage: number
  /** Enemies this side killed in the fight. */
  kills: number
}

/** A fight being put together. */
type Open = {
  first: number
  last: number
  /** Each player in it, and the tick they last hit or were hit. */
  seen: Map<number, number>
  damage: Map<number, number>
  kills: Map<number, number>
  /** The tick of its first kill, or Infinity. */
  firstKill: number
  /** Every hit in it: when, on whom, for how much. */
  hits: [number, number, number][]
  /** Sum of where the hits landed, and how many, for the fight's centre. */
  x: number
  y: number
  n: number
}

const add = (map: Map<number, number>, key: number, value: number) =>
  map.set(key, (map.get(key) ?? 0) + value)

export function findFights(timeline: Timeline): Fight[] {
  const { hz, damage: d, kills: k } = timeline.events
  const pos = timeline.positions
  const team = timeline.players.map((p) => p.team)
  const teams = [...new Set(team)].sort((a, b) => a - b)
  const laningEnd = recordingSeconds(timeline, LANING_END) * hz
  const gapAt = (t: number) => (t < laningEnd ? LANING_GAP : GAP) * hz

  const open: Open[] = []
  const done: Open[] = []

  for (let i = 0; i < d.t.length; i++) {
    const from = d.from[i]
    const to = d.to[i]
    if (from < 0 || to < 0 || d.amount[i] <= 0 || team[from] === team[to]) continue
    const t = d.t[i]

    // Fights nobody has touched for a gap are over.
    for (let f = open.length - 1; f >= 0; f--) {
      if (t - open[f].last > gapAt(open[f].last)) done.push(...open.splice(f, 1))
    }

    const touching = open.filter((fight) =>
      [from, to].some((p) => {
        const seen = fight.seen.get(p)
        return seen !== undefined && t - seen <= gapAt(seen)
      }),
    )
    let fight = touching[0]
    if (!fight) {
      fight = {
        first: t,
        last: t,
        seen: new Map(),
        damage: new Map(),
        kills: new Map(),
        firstKill: Infinity,
        hits: [],
        x: 0,
        y: 0,
        n: 0,
      }
      open.push(fight)
    }
    for (const other of touching.slice(1)) {
      merge(fight, other)
      open.splice(open.indexOf(other), 1)
    }

    fight.last = t
    fight.seen.set(from, t)
    fight.seen.set(to, t)
    add(fight.damage, team[from], d.amount[i])
    fight.hits.push([t, to, d.amount[i]])
    const frame = Math.min(Math.round((t / hz) * pos.hz), pos.frames - 1)
    fight.x += pos.x[to][frame]
    fight.y += pos.y[to][frame]
    fight.n++
  }
  done.push(...open)
  done.sort((a, b) => a.first - b.first)

  // Join fights that overlap in time and are close by, until no two are.
  const near = (NEAR / pos.quant) ** 2
  const close = (a: Open, b: Open) => {
    const dx = a.x / a.n - b.x / b.n
    const dy = a.y / a.n - b.y / b.n
    return dx * dx + dy * dy <= near
  }
  for (let a = 0; a < done.length; a++) {
    for (
      let b = a + 1;
      b < done.length && done[b].first <= done[a].last + gapAt(done[a].last);
      b++
    ) {
      if (!close(done[a], done[b])) continue
      merge(done[a], done[b])
      done.splice(b, 1)
      b = a
    }
  }

  // Each death goes to the fight its victim was in when they fell.
  for (let i = 0; i < k.t.length; i++) {
    const victim = k.victim[i]
    const t = k.t[i]
    const fight = done.find(
      (f) => f.seen.has(victim) && f.first <= t && t <= f.last + KILL_GRACE * hz,
    )
    if (!fight) continue
    fight.last = Math.max(fight.last, t)
    fight.firstKill = Math.min(fight.firstKill, t)
    for (const p of [k.killer[i], ...k.assisters[i]]) {
      if (p >= 0 && team[p] !== team[victim] && !fight.seen.has(p)) fight.seen.set(p, t)
    }
    const winner = teams.find((x) => x !== team[victim])
    if (winner !== undefined) add(fight.kills, winner, 1)
  }

  // When someone first lost `share` of their health inside some `BURST` of the fight, or
  // Infinity if nobody did.
  const hurtAt = (fight: Open, share: number) => {
    const hits = fight.hits.sort((a, b) => a[0] - b[0])
    const window = new Map<number, number>()
    let tail = 0
    for (const [t, to, amount] of hits) {
      add(window, to, amount)
      while (hits[tail][0] < t - BURST * hz) {
        add(window, hits[tail][1], -hits[tail][2])
        tail++
      }
      const frame = Math.min(Math.round((t / hz) * pos.hz), pos.frames - 1)
      if (window.get(to)! >= share * pos.maxHp[to][frame]) return t
    }
    return Infinity
  }

  // Each fight kept, and when it came to a head: its first kill or near-kill.
  const kept = done.flatMap((fight) => {
    const laning = fight.first < laningEnd
    const decisive = Math.min(fight.firstKill, hurtAt(fight, laning ? LANING_HURT : HURT))
    if (decisive === Infinity) return []
    if (laning) trim(fight, decisive - LANING_LEAD * hz)
    return [{ fight, laning }]
  })
  kept.sort((a, b) => a.fight.first - b.fight.first)

  // A fight that picks up again soon after another, nearby and with someone from it, is
  // the same one carried on: a chase, or a 2v2 that ends as the last two's 1v1. Nearby,
  // since someone who died in one fight can respawn and walk into another across the
  // map within the gap. Joined only now,
  // when both have counted as fights -- joining poke this way would chain a lane's
  // trades back together.
  for (let b = 1; b < kept.length; b++) {
    const later = kept[b].fight
    const earlier = kept
      .slice(0, b)
      .findLast(
        ({ fight }) =>
          later.first - fight.last <= GAP * hz &&
          close(fight, later) &&
          [...later.seen.keys()].some((p) => fight.seen.has(p)),
      )
    if (!earlier) continue
    merge(earlier.fight, later)
    kept.splice(b--, 1)
  }

  // Starts `fight` at `first`, leaving out the hits before it and anyone only in those.
  function trim(fight: Open, first: number) {
    if (first <= fight.first) return
    fight.first = first
    fight.hits = fight.hits.filter(([t]) => t >= first)
    fight.damage.clear()
    for (const [, to, amount] of fight.hits) {
      const by = teams.find((x) => x !== team[to])
      if (by !== undefined) add(fight.damage, by, amount)
    }
    for (const [p, seen] of fight.seen) if (seen < first) fight.seen.delete(p)
  }

  const half = teams.map((x) => Math.ceil(team.filter((y) => y === x).length / 2))
  return kept.map(({ fight, laning }): Fight => {
    const sides = teams.map((x): FightSide => ({
      team: x,
      players: [...fight.seen.keys()].filter((p) => team[p] === x).sort((a, b) => a - b),
      damage: fight.damage.get(x) ?? 0,
      kills: fight.kills.get(x) ?? 0,
    })) as [FightSide, FightSide]
    const [a, b] = sides
    const kind =
      a.players.length >= half[0] && b.players.length >= half[1]
        ? 'teamfight'
        : laning
          ? 'lane'
          : 'skirmish'
    const lead = a.kills - b.kills || a.damage - b.damage
    const at = fight.hits.map(([t, to]) => {
      const frame = Math.min(Math.round((t / hz) * pos.hz), pos.frames - 1)
      return [pos.x[to][frame] * pos.quant, pos.y[to][frame] * pos.quant]
    })
    const x = at.reduce((sum, p) => sum + p[0], 0) / Math.max(at.length, 1)
    const y = at.reduce((sum, p) => sum + p[1], 0) / Math.max(at.length, 1)
    const spread = at.map(([px, py]) => Math.hypot(px - x, py - y)).sort((m, n) => m - n)
    return {
      start: fight.first / hz,
      end: fight.last / hz,
      sides,
      kind,
      x,
      y,
      radius: spread[Math.floor((spread.length - 1) * SPREAD)] ?? 0,
      winner: lead > 0 ? 0 : lead < 0 ? 1 : -1,
    }
  })
}

function merge(into: Open, from: Open) {
  into.first = Math.min(into.first, from.first)
  into.last = Math.max(into.last, from.last)
  for (const [p, t] of from.seen) into.seen.set(p, Math.max(t, into.seen.get(p) ?? t))
  for (const [x, v] of from.damage) add(into.damage, x, v)
  for (const [x, v] of from.kills) add(into.kills, x, v)
  into.firstKill = Math.min(into.firstKill, from.firstKill)
  into.hits.push(...from.hits)
  into.x += from.x
  into.y += from.y
  into.n += from.n
}

/** "2v3": how many took part on each side. */
export function fightLabel(fight: Fight) {
  return `${fight.sides[0].players.length}v${fight.sides[1].players.length}`
}
