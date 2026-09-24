import { useMemo, useState, type ReactNode } from 'react'
import { sourceOf } from '../abilities'
import {
  damageIndex,
  damageSummary,
  type Hit,
  type Party,
  type Share,
  type Side,
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

/** Rows per breakdown before the rest are folded into a count. */
const TOP = 4

/**
 * The summary is recomputed at most this many times per match second of playhead
 * movement. Several times a second is live enough for a number, and at 16x speed it
 * keeps the panel from redoing its sums on every animation frame.
 */
const STEPS_PER_SECOND = 4

const TABS = ['Damage', 'Items', 'Souls', 'Map'] as const

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

  return (
    <div className="space-y-4 px-3 py-3">
      <div role="group" aria-label="Time span" className="flex items-center gap-1">
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

      <SideBlock title="Dealt" partyTitle="To" side={summary.dealt} timeline={timeline} />
      <SideBlock title="Taken" partyTitle="From" side={summary.taken} timeline={timeline} />

      <div>
        <h4 className="fact-label mb-1.5">Recent hits</h4>
        {summary.recent.length === 0 ? (
          <p className="text-ui-muted text-[0.75rem]">No hits in this span.</p>
        ) : (
          <ol className="space-y-0.5">
            {summary.recent.map((hit) => (
              <HitRow key={hit.id} hit={hit} timeline={timeline} />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function SideBlock({
  title,
  partyTitle,
  side,
  timeline,
}: {
  title: string
  partyTitle: string
  side: Side
  timeline: Timeline
}) {
  return (
    <div>
      <p className="mb-2 flex items-baseline gap-2">
        <span className="text-ui-muted w-12 text-[0.8125rem]">{title}</span>
        <span className="text-ui-fg text-[1.125rem] leading-none font-semibold">
          {compact(side.total)}
        </span>
        <span className="text-ui-muted text-[0.75rem]">
          {side.hits} {side.hits === 1 ? 'hit' : 'hits'}
        </span>
      </p>
      {side.hits > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Breakdown
            title={partyTitle}
            shares={side.byParty}
            total={side.total}
            label={(party) => <PartyLabel party={party} timeline={timeline} />}
          />
          <Breakdown
            title="With"
            shares={side.bySource}
            total={side.total}
            label={(source) => <SourceLabel source={source} timeline={timeline} />}
          />
        </div>
      )}
    </div>
  )
}

function Breakdown<T>({
  title,
  shares,
  total,
  label,
}: {
  title: string
  shares: Share<T>[]
  total: number
  label: (of: T) => ReactNode
}) {
  const shown = shares.slice(0, TOP)
  const rest = shares.length - shown.length
  return (
    <div className="min-w-0">
      <h4 className="fact-label mb-1">{title}</h4>
      <ul className="space-y-0.5">
        {shown.map((share) => (
          <li key={share.key} className="relative flex items-center gap-1.5 py-0.5 pr-1">
            {/* The share of the side's total, as a bar behind the row. Neutral: it is a
                proportion, and the rows it sits behind already say what of. */}
            <span
              aria-hidden="true"
              className="bg-ui-raised absolute inset-y-0 left-0 rounded-[3px]"
              style={{ width: `${total > 0 ? (share.amount / total) * 100 : 0}%` }}
            />
            <span className="relative flex min-w-0 flex-1 items-center gap-1.5">
              {label(share.of)}
            </span>
            <span className="text-ui-fg relative text-[0.75rem] tabular-nums">
              {compact(share.amount)}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="text-ui-muted mt-0.5 text-[0.6875rem]">+{rest} more</p>}
    </div>
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
      <span className="flex min-w-0 max-w-[40%] items-center gap-1.5">
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
