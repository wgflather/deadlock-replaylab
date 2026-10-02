import type { ReactNode } from 'react'
import {
  midBossAt,
  riftAt,
  urnAt,
  type BreakableSpot,
  type CampState,
  type PowerupSpot,
} from '../demo/mapState'
import { AMBER, SAPPHIRE, TEAM_SHORT_NAMES, type PowerupKind, type Timeline } from '../demo/types'
import { clock, gameClock } from '../demo/usePlayback'
import midBoss from '../assets/map/midboss.png'
import riftIcon from '../assets/map/unstable-rift.png'
import powerupGun from '../assets/map/powerup-gun.svg'
import powerupSurvival from '../assets/map/powerup-survival.svg'
import powerupCasting from '../assets/map/powerup-casting.svg'
import powerupMovement from '../assets/map/powerup-movement.svg'
import dropoffEnemy from '../assets/map/urn-dropoff-enemy.webp'
import dropoffTeam from '../assets/map/urn-dropoff-team.webp'
import urnPickup from '../assets/map/urn-pickup.webp'
import { HeroFace } from './HeroIcon'

/**
 * The map's timers, as a compact two-column grid over the map: the Mid-Boss, the Urn,
 * the Unstable Rift and each tier of neutral camp -- whether it is up, and how long until the next thing
 * happens. Each cell's name is in its tooltip.
 *
 * The replay is recorded, so "next" is what did happen next, counted down from the
 * playhead. See ../demo/mapState for how a camp's clear is inferred when nobody saw it.
 */

const TIER_NAMES: Record<number, string> = {
  1: 'Tier 1 camps',
  2: 'Tier 2 camps',
  3: 'Tier 3 camps',
}

/** "1:23" from `now` to `then`, rounded up so it never reads 0:00 before it happens;
 * or the in-game time if it has passed. */
function countdown(timeline: Timeline, now: number, then: number) {
  return then > now ? clock(Math.ceil(then - now)) : gameClock(timeline, then)
}

/** The Urn waiting to be picked up: the game minimap's own jar. Shared with the map. */
export function UrnGlyph({ size = 14 }: { size?: number }) {
  return (
    <img
      src={urnPickup}
      alt=""
      draggable={false}
      className="shrink-0"
      style={{ height: size, width: 'auto' }}
    />
  )
}

/** The Mid-Boss: the minimap's own picture, as the map draws it. The picture carries a
 * wide glow margin, so it is drawn larger than the slot and allowed to spill into it
 * rather than shrinking the figure to a speck. Faded while down, as on the map. */
function MidBossGlyph({ up, size = 20 }: { up: boolean; size?: number }) {
  return (
    <img
      src={midBoss}
      alt=""
      draggable={false}
      className="-my-1 shrink-0 select-none"
      style={{ height: size, width: size, opacity: up ? 1 : 0.35 }}
    />
  )
}

/** Where a carried Urn is to be delivered: the game minimap's drop-off, in its "team"
 * version for the side carrying it and its "enemy" version for the side trying to stop
 * them. Shared with the map. */
export function DropoffGlyph({ enemy, size = 20 }: { enemy: boolean; size?: number }) {
  return (
    <img
      src={enemy ? dropoffEnemy : dropoffTeam}
      alt=""
      draggable={false}
      className="shrink-0"
      style={{ height: size, width: 'auto' }}
    />
  )
}

/**
 * A camp's marker, as the game's minimap draws it: a triangle over one bar per tier past
 * the first. Filled while the camp is up; an outline while it is down. Drawn rather than
 * mirrored -- the source is this simple, and a vector stays crisp at any zoom.
 */
export function CampGlyph({ tier, up, size = 14 }: { tier: number; up: boolean; size?: number }) {
  // The source's own geometry, on a 21-unit-wide box: a 16-tall triangle, then 4-tall
  // bars with 2 and 3 units of gap.
  const bars = [
    [18, 4],
    [25, 4],
  ].slice(0, Math.max(0, tier - 1))
  const height = tier === 1 ? 16 : tier === 2 ? 22 : 29
  const paint = up
    ? { fill: 'var(--data-camp)', stroke: 'var(--data-marker-shadow)' }
    : { fill: 'var(--ui-inset)', stroke: 'var(--data-camp)' }
  return (
    <svg
      aria-hidden="true"
      viewBox={`-1 -1 23 ${height + 2}`}
      height={size}
      width={(size * 23) / (height + 2)}
      className="shrink-0 overflow-visible"
    >
      <path d="M10.5 0L21 16H0Z" strokeWidth={1.5} strokeLinejoin="round" style={paint} />
      {bars.map(([y, h]) => (
        <rect key={y} x={0.5} y={y} width={20} height={h} strokeWidth={1.5} style={paint} />
      ))}
    </svg>
  )
}

/** A Sinner's Sacrifice, as the game's minimap draws one: a rounded square with a ring
 * in it. Filled while standing; an outline while it is broken. */
export function SinnerGlyph({ up, size = 12 }: { up: boolean; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 44 50"
      height={size}
      width={(size * 44) / 50}
      className="shrink-0"
    >
      <rect
        x={2}
        y={2}
        width={40}
        height={46}
        rx={7}
        strokeWidth={3}
        style={
          up
            ? { fill: 'var(--data-sinner)', stroke: 'var(--data-marker-shadow)' }
            : { fill: 'var(--ui-inset)', stroke: 'var(--data-sinner)' }
        }
      />
      <circle
        cx={22}
        cy={25}
        r={8}
        fill="none"
        strokeWidth={4}
        style={{ stroke: up ? '#000' : 'var(--data-sinner)' }}
      />
    </svg>
  )
}

/** A crate: a small square, only ever drawn while it stands. */
export function CrateGlyph({ size = 6 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" width={size} height={size} className="shrink-0">
      <rect
        x={1}
        y={1}
        width={8}
        height={8}
        rx={1}
        strokeWidth={1.5}
        style={{ fill: 'var(--data-crate)', stroke: 'var(--data-marker-shadow)' }}
      />
    </svg>
  )
}

/** The Unstable Rift: the game's own icon, a dark tear edged in teal. Taller than wide,
 * so `size` is its height. Faded until it opens. Shared with the map. */
export function RiftGlyph({ size = 14, faded = false }: { size?: number; faded?: boolean }) {
  return (
    <img
      src={riftIcon}
      alt=""
      draggable={false}
      className="shrink-0 select-none"
      style={{ height: size, width: 'auto', opacity: faded ? 0.5 : 1 }}
    />
  )
}

/** A team's name in its colour. */
function Team({ team }: { team: number }) {
  return (
    <span className={team === AMBER ? 'text-data-amber' : 'text-data-sapphire'}>
      {TEAM_SHORT_NAMES[team]}
    </span>
  )
}

/** A Golden Statue: a small bust on a plinth, in gold. */
export function StatueGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 14"
      height={size}
      width={(size * 12) / 14}
      className="shrink-0"
    >
      <path
        d="M6 1a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 6 1zM2.5 10c0-2.4 1.6-3.8 3.5-3.8S9.5 7.6 9.5 10zM1 10.8h10V13H1z"
        strokeWidth={1}
        strokeLinejoin="round"
        style={{ fill: 'var(--data-statue)', stroke: 'var(--data-marker-shadow)' }}
      />
    </svg>
  )
}

const POWERUP_ICONS: Record<PowerupKind, string> = {
  gun: powerupGun,
  survival: powerupSurvival,
  casting: powerupCasting,
  movement: powerupMovement,
}

export const POWERUP_NAMES: Record<PowerupKind, string> = {
  gun: 'Gun',
  survival: 'Survival',
  casting: 'Casting',
  movement: 'Movement',
}

/**
 * A powerup: the game's own minimap icon for its kind (assets/map/powerup-*.svg, white
 * silhouettes), used as a mask so it takes the powerup colour and a marker's shadow.
 */
export function PowerupGlyph({ kind, size = 14 }: { kind: PowerupKind; size?: number }) {
  const mask = `url(${POWERUP_ICONS[kind]}) center / contain no-repeat`
  // The shadow goes on a wrapper: on the masked element itself the mask would cut it off.
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0"
      style={{ filter: 'drop-shadow(0 0 1px var(--data-marker-shadow))' }}
    >
      <span
        className="inline-block"
        style={{
          width: size,
          height: size,
          background: 'var(--data-powerup)',
          mask,
          WebkitMask: mask,
        }}
      />
    </span>
  )
}

/** A Healing Snack: a small apple, in health green. */
export function SnackGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" width={size} height={size} className="shrink-0">
      <path
        d="M6 3.4C4.6 2.6 1.5 2.9 1.5 6.6 1.5 9.4 3.4 11 4.6 11c.6 0 .9-.3 1.4-.3s.8.3 1.4.3c1.2 0 3.1-1.6 3.1-4.4C10.5 2.9 7.4 2.6 6 3.4zM6 3.2C6 2 6.8 1 8 .9 7.9 2.1 7.2 3 6 3.2z"
        strokeWidth={1}
        strokeLinejoin="round"
        style={{ fill: 'var(--data-snack)', stroke: 'var(--data-marker-shadow)' }}
      />
    </svg>
  )
}

/**
 * One timer: an icon, its state, and when it next changes. The name is the icon's
 * tooltip rather than a label -- the glyphs are the map's own, so the label mostly
 * repeats what the icon already says, and dropping it halves the panel.
 */
function Cell({
  icon,
  label,
  children,
  next,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
  next?: string
}) {
  return (
    <div
      title={next === undefined ? label : `${label} — next ${next}`}
      className="flex min-w-0 items-center gap-1.5 py-0.5"
    >
      <span className="flex w-3.5 shrink-0 justify-center">{icon}</span>
      <span className="sr-only">{label}</span>
      <span className="text-ui-fg flex min-w-0 items-center gap-1 whitespace-nowrap">
        {children}
      </span>
      {next !== undefined && (
        <span className="text-ui-muted ml-auto pl-1 whitespace-nowrap tabular-nums">{next}</span>
      )}
    </div>
  )
}

/** Who holds or took something: their face, named by its tooltip. */
function Who({ timeline, player }: { timeline: Timeline; player: number }) {
  const p = timeline.players[player]
  if (!p) return null
  return <HeroFace player={p} size={14} />
}

/** Side of the map the Urn is on, in the viewer's terms: west or east of centre. */
function side(x: number) {
  return x < 0 ? 'west' : 'east'
}

/** How many of `spots` stand, and when the next fallen one comes back. */
function standingOf(spots: BreakableSpot[]) {
  const next = spots
    .map((spot) => spot.nextSpawn)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)[0]
  return {
    up: spots.filter((spot) => spot.standing).length,
    total: spots.length,
    next: next ?? null,
  }
}

export function MapTimers({
  timeline,
  at,
  camps,
  sinners,
  crates,
  statues,
  snacks,
  powerups,
}: {
  timeline: Timeline
  at: number
  /** The camps at `at`, already worked out for the map. */
  camps: CampState[]
  /** The Sinner's Sacrifice, crate, Golden Statue and Healing Snack spots at `at`. */
  sinners: BreakableSpot[]
  crates: BreakableSpot[]
  statues: BreakableSpot[]
  snacks: BreakableSpot[]
  /** The two powerup spots at `at`. */
  powerups: PowerupSpot[]
}) {
  const sinnerState = standingOf(sinners)
  const crateState = standingOf(crates)
  const statueState = standingOf(statues)
  const snackState = standingOf(snacks)
  const powerupState = standingOf(powerups)
  const powerupKinds = powerups.flatMap((p) => (p.kind ? [p.kind] : []))
  const boss = midBossAt(timeline, at)
  const urn = urnAt(timeline, at)
  const rift = riftAt(timeline, at)
  const tiers = [1, 2, 3].map((tier) => {
    const inTier = camps.filter((c) => c.tier === tier)
    const upcoming = inTier
      .map((c) => c.nextSpawn)
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b)
    return {
      tier,
      total: inTier.length,
      up: inTier.filter((c) => c.up).length,
      next: upcoming[0] ?? null,
    }
  })
  const urnNext =
    (urn.state === 'waiting' || urn.state === 'delivered') && urn.nextSpawn !== null
      ? countdown(timeline, at, urn.nextSpawn)
      : undefined

  return (
    <section
      aria-label="Map timers"
      className="bg-ui-surface/95 border-ui-line rounded-ui grid w-[16.5rem] max-w-full grid-cols-2 gap-x-3 border px-2 py-1 text-[0.6875rem]"
    >
      <Cell
        icon={<MidBossGlyph up={boss.state === 'up'} />}
        label="Mid-Boss"
        next={
          boss.state === 'down' && boss.nextSpawn !== null
            ? countdown(timeline, at, boss.nextSpawn)
            : undefined
        }
      >
        {boss.state === 'up' ? (
          <span
            aria-label={`Up, ${Math.round(boss.hpFraction * 100)}% health`}
            className="bg-ui-line block h-1 w-10 overflow-hidden rounded-full"
          >
            <span
              className="block h-full"
              style={{
                width: `${boss.hpFraction * 100}%`,
                background: `color-mix(in srgb, var(--data-health) ${Math.round(boss.hpFraction * 100)}%, var(--data-damage))`,
              }}
            />
          </span>
        ) : boss.killer !== null ? (
          <>
            <span className="text-ui-muted">Killed</span>
            <Who timeline={timeline} player={boss.killer} />
          </>
        ) : (
          <span className="text-ui-muted">Down</span>
        )}
      </Cell>

      <Cell icon={<span className="-my-0.5 flex"><UrnGlyph size={16} /></span>} label="Urn" next={urnNext}>
        {urn.state === 'waiting' ? (
          <span className="text-ui-muted">{urn.nextSpawn === null ? 'None' : 'Soon'}</span>
        ) : urn.state === 'onMap' ? (
          <span className="capitalize">{side(urn.x)}</span>
        ) : urn.state === 'carried' ? (
          <>
            <span className="text-ui-muted">Held</span>
            <Who timeline={timeline} player={urn.player} />
          </>
        ) : (
          <>
            <span className="text-ui-muted">Delivered</span>
            <Who timeline={timeline} player={urn.player} />
          </>
        )}
      </Cell>

      <Cell
        icon={<RiftGlyph faded={rift.state !== 'open'} />}
        label={`Unstable Rift — taken ${rift.taken.get(AMBER) ?? 0} ${TEAM_SHORT_NAMES[AMBER]}, ${rift.taken.get(SAPPHIRE) ?? 0} ${TEAM_SHORT_NAMES[SAPPHIRE]}`}
        next={
          rift.state === 'announced'
            ? countdown(timeline, at, rift.opensAt)
            : (rift.state === 'none' || rift.state === 'over') && rift.next !== null
              ? countdown(timeline, at, rift.next)
              : undefined
        }
      >
        {rift.state === 'none' ? (
          <span className="text-ui-muted">{rift.next === null ? 'None' : 'Soon'}</span>
        ) : rift.state === 'announced' ? (
          <span className="text-ui-muted capitalize">{side(rift.x)} soon</span>
        ) : rift.state === 'open' ? (
          <span className="capitalize">
            {side(rift.x)}
            {rift.contested && <span className="text-ui-muted"> · taking</span>}
          </span>
        ) : rift.outcome === 'captured' ? (
          <Team team={rift.team} />
        ) : (
          <span className="text-ui-muted">Spilled</span>
        )}
      </Cell>

      {tiers.map(({ tier, total, up, next }) =>
        total === 0 ? null : (
          <Cell
            key={tier}
            icon={<CampGlyph tier={tier} up={up > 0} size={12} />}
            label={TIER_NAMES[tier]}
            next={next !== null ? countdown(timeline, at, next) : undefined}
          >
            <Count up={up} total={total} />
          </Cell>
        ),
      )}
      {sinnerState.total > 0 && (
        <Cell
          icon={<SinnerGlyph up={sinnerState.up > 0} size={11} />}
          label="Sinner's Sacrifice"
          next={sinnerState.next !== null ? countdown(timeline, at, sinnerState.next) : undefined}
        >
          <Count up={sinnerState.up} total={sinnerState.total} />
        </Cell>
      )}
      {crateState.total > 0 && (
        <Cell
          icon={<CrateGlyph size={8} />}
          label="Crates"
          next={crateState.next !== null ? countdown(timeline, at, crateState.next) : undefined}
        >
          <Count up={crateState.up} total={crateState.total} />
        </Cell>
      )}
      {statueState.total > 0 && (
        <Cell
          icon={<StatueGlyph size={11} />}
          label="Golden statues"
          next={statueState.next !== null ? countdown(timeline, at, statueState.next) : undefined}
        >
          <Count up={statueState.up} total={statueState.total} />
        </Cell>
      )}
      {powerupState.total > 0 && (
        <Cell
          icon={<PowerupGlyph kind={powerupKinds[0] ?? 'gun'} size={12} />}
          label={
            powerupKinds.length
              ? `Powerups: ${powerupKinds.map((k) => POWERUP_NAMES[k]).join(', ')}`
              : 'Powerups'
          }
          next={powerupState.next !== null ? countdown(timeline, at, powerupState.next) : undefined}
        >
          {powerupKinds.length ? (
            <span className="flex items-center gap-0.5">
              {powerupKinds.map((k, i) => (
                <PowerupGlyph key={i} kind={k} size={11} />
              ))}
            </span>
          ) : (
            <span className="text-ui-muted">Taken</span>
          )}
        </Cell>
      )}
      {snackState.total > 0 && (
        <Cell
          icon={<SnackGlyph size={10} />}
          label="Healing snacks"
          next={snackState.next !== null ? countdown(timeline, at, snackState.next) : undefined}
        >
          <Count up={snackState.up} total={snackState.total} />
        </Cell>
      )}
    </section>
  )
}

/** "4/6" standing, the total stepped back so the live number reads first. */
function Count({ up, total }: { up: number; total: number }) {
  return (
    <span className="tabular-nums">
      {up}
      <span className="text-ui-faint">/{total}</span>
    </span>
  )
}
