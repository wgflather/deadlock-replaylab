import { useMemo, useState, type ReactNode } from 'react'
import { sourceOf } from '../abilities'
import {
  DAMAGE_TYPES,
  damageIndex,
  damageSummary,
  type DamageType,
  type Group,
  type Hit,
  type Party,
  type Share,
  type Side,
  type TypeSplit as Split,
} from '../demo/damage'
import { KIND_LABELS } from '../demo/kinds'
import type { Row, Timeline } from '../demo/types'
import { gameClock } from '../demo/usePlayback'
import { compact } from '../stats/format'
import { HeroFace } from './HeroIcon'
import { ItemsTab } from './ItemsTab'
import { MapActivityTab } from './MapActivityTab'
import { SoulsTab } from './SoulsTab'

/**
 * One player, looked at closely: opened by clicking them on the map.
 *
 * Laid out as tabs, one per thing worth inspecting -- damage, items, and in time
 * abilities and their cooldowns and the modifiers on a hero at a given moment -- all
 * reading the same selected player at the same playhead.
 */

/** How far back the Damage tab looks from the playhead, in match seconds. A fight is
 * over in ten; thirty takes in the run-up; the whole match so far is the running
 * total, the same span the scoreboard's own damage covers. */
const WINDOWS = [
  ['10s', 10],
  ['30s', 30],
  ['Match', Infinity],
] as const

/** Rows per breakdown before the rest are folded behind "Show all". */
const TOP = 5

/**
 * The summary is recomputed at most this many times per match second of playhead
 * movement. Several times a second is live enough for a number, and at 16x speed it
 * keeps the panel from redoing its sums on every animation frame.
 */
const STEPS_PER_SECOND = 4

const TABS = ['Damage', 'Items', 'Souls', 'Map'] as const

/** The kinds of damage, in the game's words and the shop's hues for gun and spirit. */
const TYPE_STYLES: Record<DamageType, { label: string; color: string }> = {
  gun: { label: 'Gun', color: 'var(--data-item-weapon)' },
  spirit: { label: 'Spirit', color: 'var(--data-item-spirit)' },
  melee: { label: 'Melee', color: 'var(--data-melee)' },
  other: { label: 'Other', color: 'var(--ui-faint)' },
}

export function PlayerInspector({
  timeline,
  player,
  row,
  at,
  onClose,
}: {
  timeline: Timeline
  player: number
  /** Their scoreboard row at the playhead. */
  row: Row
  at: number
  onClose: () => void
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Damage')
  const info = timeline.players[player]

  return (
    <section aria-label={`Inspecting ${info.name}`} className="ui-panel overflow-hidden">
      <header className="section-band flex items-center gap-2.5 px-3 py-2">
        <HeroFace player={info} size={32} />
        <div className="min-w-0 flex-1">
          <h3 className="text-ui-fg truncate text-[0.9375rem] leading-tight font-semibold">
            {info.name}
          </h3>
          <p className="text-ui-muted flex gap-2.5 text-[0.75rem] leading-tight">
            <span>Level {row.level}</span>
            <span className="tabular-nums">
              {row.kills} / {row.deaths} / {row.assists}
            </span>
            {!row.alive && <span className="text-data-death">Dead</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="text-ui-muted hover:text-ui-fg rounded-ui px-2 py-1 text-[0.875rem] transition-colors"
        >
          ✕
        </button>
      </header>

      <div role="tablist" className="border-ui-line flex gap-1 border-b px-3 pt-2">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`-mb-px border-b-2 px-2 pb-1.5 text-[0.8125rem] font-medium transition-colors ${
              tab === name
                ? 'text-ui-fg border-ui-accent'
                : 'text-ui-muted hover:text-ui-fg border-transparent'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'Damage' && <DamageTab timeline={timeline} player={player} at={at} />}
      {tab === 'Items' && <ItemsTab timeline={timeline} player={player} at={at} />}
      {tab === 'Souls' && <SoulsTab timeline={timeline} player={player} at={at} />}
      {tab === 'Map' && <MapActivityTab timeline={timeline} player={player} at={at} />}
    </section>
  )
}

function DamageTab({ timeline, player, at }: { timeline: Timeline; player: number; at: number }) {
  const [span, setSpan] = useState<number>(10)
  const index = useMemo(() => damageIndex(timeline), [timeline])
  const step = Math.floor(at * STEPS_PER_SECOND) / STEPS_PER_SECOND
  const summary = useMemo(
    () => damageSummary(timeline, index, player, Math.max(0, step - span), step),
    [timeline, index, player, step, span],
  )

  // Three sections -- what they dealt, what they took, the hits themselves -- each ruled
  // off from the next, under the span they all share.
  return (
    <div>
      <div
        role="group"
        aria-label="Time span"
        className="border-ui-line flex items-center gap-1 border-b px-3 py-2"
      >
        <span className="text-ui-muted mr-1 text-[0.75rem]">Last</span>
        {WINDOWS.map(([label, seconds]) => (
          <button
            key={label}
            type="button"
            aria-pressed={span === seconds}
            onClick={() => setSpan(seconds)}
            className={`rounded-[4px] px-2 py-1 text-[0.75rem] transition-colors ${
              span === seconds ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <SideSection
        title="Dealt"
        direction="To"
        side={summary.dealt}
        timeline={timeline}
        empty="Nothing dealt in this span."
      />
      <SideSection
        title="Taken"
        direction="From"
        side={summary.taken}
        timeline={timeline}
        empty="Nothing taken in this span."
      />

      <section aria-label="Recent hits" className="px-3 py-3">
        <h4 className="section-title mb-2">Recent hits</h4>
        {summary.recent.length === 0 ? (
          <p className="text-ui-muted text-[0.75rem]">No hits in this span.</p>
        ) : (
          <>
            <div aria-hidden="true" className="mb-1 flex items-center gap-1.5">
              <span className="fact-label w-9 shrink-0">Time</span>
              <span className="w-3 shrink-0" />
              <span className="fact-label flex-1">Player</span>
              <span className="fact-label w-[40%]">Source</span>
              <span className="fact-label w-10 shrink-0 text-right">Damage</span>
            </div>
            <ol className="space-y-0.5">
              {summary.recent.map((hit) => (
                <HitRow key={hit.id} hit={hit} timeline={timeline} />
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  )
}

/** One direction of the player's damage: its total, what kind of damage it was, and who
 * and what it was between. */
function SideSection({
  title,
  direction,
  side,
  timeline,
  empty,
}: {
  title: string
  /** "To" or "From": how the other side of each hit is named. */
  direction: string
  side: Side
  timeline: Timeline
  empty: string
}) {
  const [by, setBy] = useState<'party' | 'source'>('party')
  const [all, setAll] = useState(false)
  // Open rows by key, kept across playhead steps so a row does not fold shut while the
  // replay runs; a key that drops out of the span simply has nothing to open.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const count = by === 'party' ? side.byParty.length : side.bySource.length
  const limit = all ? undefined : TOP
  const partyTitle = direction === 'To' ? 'Target' : 'Attacker'

  return (
    <section aria-label={title} className="border-ui-line border-b px-3 py-3">
      <header className="mb-2.5 flex items-baseline gap-2">
        <h4 className="section-title">{title}</h4>
        <span className="text-ui-fg ml-auto text-[1.125rem] leading-none font-semibold tabular-nums">
          {compact(side.total)}
        </span>
        <span className="text-ui-muted text-[0.75rem] tabular-nums">
          {side.hits} {side.hits === 1 ? 'hit' : 'hits'}
        </span>
      </header>
      {side.hits === 0 ? (
        <p className="text-ui-muted text-[0.75rem]">{empty}</p>
      ) : (
        <>
          <KindTable direction={direction} side={side} />
          <div className="mt-3 mb-1 flex items-center gap-1 pr-1">
            <span className="text-ui-muted mr-1 text-[0.75rem]">By</span>
            {(
              [
                ['party', partyTitle],
                ['source', 'Source'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={by === value}
                onClick={() => setBy(value)}
                className={`rounded-[4px] px-2 py-0.5 text-[0.75rem] transition-colors ${
                  by === value ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
                }`}
              >
                {label}
              </button>
            ))}
            <span aria-hidden="true" className="fact-label ml-auto w-10 text-right">
              Dmg
            </span>
            <span aria-hidden="true" className="fact-label ml-1.5 w-6 text-right">
              Hits
            </span>
          </div>
          <ul className="space-y-0.5">
            {by === 'party'
              ? side.byParty.slice(0, limit).map((group) => (
                  <GroupRow
                    key={group.key}
                    group={group}
                    total={side.total}
                    open={open.has(group.key)}
                    onToggle={() => toggle(group.key)}
                    timeline={timeline}
                  />
                ))
              : side.bySource.slice(0, limit).map((group) => (
                  <li key={group.key} className="relative flex items-center gap-1.5 py-0.5 pr-1">
                    <ShareBar share={group} of={side.total} />
                    <ShareCells share={group}>
                      <SourceLabel source={group.of} timeline={timeline} />
                      <Faces parties={group.parts} timeline={timeline} />
                    </ShareCells>
                  </li>
                ))}
          </ul>
          {count > TOP && (
            <button
              type="button"
              onClick={() => setAll(!all)}
              className="text-ui-muted hover:text-ui-fg mt-1 text-[0.6875rem] transition-colors"
            >
              {all ? 'Show fewer' : `Show all ${count}`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

/** The three kinds of damage the percentages are given for; "other" only shows in a bar. */
const KINDS = ['gun', 'spirit', 'melee'] as const

/**
 * What kind of damage a side was, as a small table: one row for heroes and one for
 * creeps and objectives, so farming never dilutes the fight numbers. Each row's shares are
 * of its own total, with a stacked bar under it to read at a glance.
 */
function KindTable({ direction, side }: { direction: string; side: Side }) {
  const rows = [
    { key: 'heroes', label: `${direction} heroes`, split: side.heroes },
    { key: 'world', label: `${direction} creeps & objectives`, split: side.world },
  ].filter((row) => row.split.total > 0)
  return (
    <div className="grid grid-cols-[1fr_repeat(3,2.5rem)_3rem] items-baseline gap-x-1.5 text-[0.75rem]">
      <span />
      {KINDS.map((kind) => (
        <span key={kind} className="fact-label flex items-center justify-end gap-1">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-[2px]"
            style={{ background: TYPE_STYLES[kind].color }}
          />
          {TYPE_STYLES[kind].label}
        </span>
      ))}
      <span className="fact-label text-right">Total</span>

      {rows.map(({ key, label, split }) => (
        <KindRow key={key} label={label} split={split} />
      ))}
    </div>
  )
}

function KindRow({ label, split }: { label: string; split: Split }) {
  const percent = (type: DamageType) => (split.byType[type] / split.total) * 100
  return (
    <>
      <span className="text-ui-muted mt-1.5 truncate" title={label}>
        {label}
      </span>
      {KINDS.map((kind) => (
        <span
          key={kind}
          className={`mt-1.5 text-right tabular-nums ${
            split.byType[kind] > 0 ? 'text-ui-fg' : 'text-ui-faint'
          }`}
        >
          {split.byType[kind] > 0 ? `${Math.round(percent(kind))}%` : '–'}
        </span>
      ))}
      <span className="text-ui-fg mt-1.5 text-right font-medium tabular-nums">
        {compact(split.total)}
      </span>
      {/* Hits that name no source -- a trooper's, a tower's -- are the faint part. */}
      <div
        aria-hidden="true"
        className="bg-ui-raised col-span-full mt-1 flex h-1 overflow-hidden rounded-full"
      >
        {DAMAGE_TYPES.map((type) => (
          <span
            key={type}
            style={{ width: `${percent(type)}%`, background: TYPE_STYLES[type].color }}
          />
        ))}
      </div>
    </>
  )
}

/** A target or attacker that opens onto the sources the damage between them came from. */
function GroupRow({
  group,
  total,
  open,
  onToggle,
  timeline,
}: {
  group: Group<Party, number>
  /** The side's total, which the row's bar is a share of. */
  total: number
  open: boolean
  onToggle: () => void
  timeline: Timeline
}) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="hover:bg-ui-raised/50 relative flex w-full items-center gap-1.5 rounded-[3px] py-0.5 pr-1 text-left"
      >
        <ShareBar share={group} of={total} />
        <span
          aria-hidden="true"
          className={`text-ui-faint relative w-2.5 shrink-0 text-[0.625rem] transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        >
          ▸
        </span>
        <ShareCells share={group}>
          <PartyLabel party={group.of} timeline={timeline} />
        </ShareCells>
      </button>
      {/* Its parts, each a share of this row rather than of the side. */}
      {open && (
        <ul className="border-ui-line mt-0.5 mb-1 ml-[5px] space-y-0.5 border-l pl-2.5">
          {group.parts.map((part) => (
            <li key={part.key} className="relative flex items-center gap-1.5 py-0.5 pr-1">
              <ShareBar share={part} of={group.amount} />
              <ShareCells share={part}>
                <SourceLabel source={part.of} timeline={timeline} />
              </ShareCells>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Most parties a source row names before folding the rest into a count. */
const FACES = 3

/** Who a source's damage was between, after its name: a hero as their face, anything else
 * -- a Walker's laser, a trooper's rifle -- by its kind. Almost always one for damage
 * taken; often several for an ability that hit a crowd. */
function Faces({ parties, timeline }: { parties: Share<Party>[]; timeline: Timeline }) {
  const rest = parties.length - FACES
  const name = ({ of }: Share<Party>) =>
    of.player >= 0 ? timeline.players[of.player]?.name : KIND_LABELS[of.kind]
  return (
    <span
      className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5 pl-1"
      title={parties.map(name).join(', ')}
    >
      {parties.slice(0, FACES).map((party) =>
        party.of.player >= 0 ? (
          <HeroFace key={party.key} player={timeline.players[party.of.player]} size={16} />
        ) : (
          <span
            key={party.key}
            className="bg-ui-bg border-ui-line text-ui-muted rounded-[3px] border px-1 text-[0.625rem] leading-[14px]"
          >
            {KIND_LABELS[party.of.kind]}
          </span>
        ),
      )}
      {rest > 0 && <span className="text-ui-muted text-[0.6875rem]">+{rest}</span>}
    </span>
  )
}

function ShareCells<T>({ share, children }: { share: Share<T>; children: ReactNode }) {
  return (
    <>
      <span className="relative flex min-w-0 flex-1 items-center gap-1.5">{children}</span>
      <span className="text-ui-fg relative w-10 text-right text-[0.75rem] tabular-nums">
        {compact(share.amount)}
      </span>
      <span className="text-ui-muted relative w-6 text-right text-[0.75rem] tabular-nums">
        {share.hits}
      </span>
    </>
  )
}

/** A share of `of`, as a bar behind its row, with a thin strip along its foot splitting it
 * by kind of damage in the kind table's colours. */
function ShareBar<T>({ share, of }: { share: Share<T>; of: number }) {
  return (
    <span
      aria-hidden="true"
      className="bg-ui-raised absolute inset-y-0 left-0 flex items-end overflow-hidden rounded-[3px]"
      style={{ width: `${of > 0 ? (share.amount / of) * 100 : 0}%` }}
    >
      {DAMAGE_TYPES.map((type) => (
        <span
          key={type}
          className="h-0.5"
          style={{
            width: `${(share.byType[type] / share.amount) * 100}%`,
            background: TYPE_STYLES[type].color,
          }}
        />
      ))}
    </span>
  )
}

function PartyLabel({ party, timeline }: { party: Party; timeline: Timeline }) {
  const player = party.player >= 0 ? timeline.players[party.player] : undefined
  if (player) {
    return (
      <>
        <HeroFace player={player} size={18} />
        <span className="text-ui-muted truncate text-[0.75rem]">{player.name}</span>
      </>
    )
  }
  return <span className="text-ui-muted truncate text-[0.75rem]">{KIND_LABELS[party.kind]}</span>
}

/** What a hit came from: its icon on a dark chip -- round for an ability, square for an
 * item or weapon, as the map draws cast icons -- and its name. */
function SourceLabel({ source, timeline }: { source: number; timeline: Timeline }) {
  const known = source >= 0 ? sourceOf(timeline.events.sources[source]) : undefined
  const name = known?.name ?? 'Other'
  return (
    <>
      <span
        aria-hidden="true"
        className={`bg-ui-bg border-ui-line-strong flex h-[18px] w-[18px] shrink-0 items-center justify-center border ${
          known?.kind === 'ability' ? 'rounded-full' : 'rounded-[3px]'
        }`}
      >
        {known?.icon && <img src={known.icon} alt="" className="h-[80%] w-[80%]" />}
      </span>
      <span className="text-ui-muted truncate text-[0.75rem]" title={name}>
        {name}
      </span>
    </>
  )
}

function HitRow({ hit, timeline }: { hit: Hit; timeline: Timeline }) {
  return (
    <li className="flex items-center gap-1.5 text-[0.75rem]">
      <span className="text-ui-muted w-9 shrink-0">{gameClock(timeline, hit.seconds)}</span>
      <span
        aria-label={hit.dealt ? 'dealt to' : 'taken from'}
        className="text-ui-muted w-3 shrink-0 text-center"
      >
        {hit.dealt ? '→' : '←'}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <PartyLabel party={hit.other} timeline={timeline} />
      </span>
      <span className="flex w-[40%] min-w-0 items-center gap-1.5">
        <SourceLabel source={hit.source} timeline={timeline} />
      </span>
      {/* Damage taken is the one amount drawn in the damage colour: it is what hurt. */}
      <span
        className={`w-10 shrink-0 text-right font-medium ${hit.dealt ? 'text-ui-fg' : 'text-data-damage'}`}
      >
        {hit.dealt ? '' : '−'}
        {compact(hit.amount)}
      </span>
    </li>
  )
}
