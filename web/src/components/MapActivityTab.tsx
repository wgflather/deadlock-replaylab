import { useMemo } from 'react'
import { breaksBy, urnsDeliveredBy } from '../demo/mapState'
import type { Timeline } from '../demo/types'
import { gameClock } from '../demo/usePlayback'
import type { PowerupKind } from '../demo/types'
import {
  CrateGlyph,
  POWERUP_NAMES,
  PowerupGlyph,
  SinnerGlyph,
  SnackGlyph,
  StatueGlyph,
  UrnGlyph,
} from './MapTimers'

/**
 * The inspector's Map tab: what a player took from the map up to the playhead -- crates
 * broken, Sinner's Sacrifices broken, Healing Snacks eaten, powerups taken and Urns
 * delivered -- and a list of the latest.
 *
 * A Sinner's Sacrifice is credited to the last hero who hit it and an Urn to whoever
 * delivered it, both named by the replay. A crate is not: it goes to the nearest hero
 * when it broke, if one was close -- see the parser's note -- so crate counts are a
 * close estimate rather than the game's own tally.
 */

/** How many of the latest the list shows. */
const RECENT = 12

type Entry = {
  seconds: number
  kind: 'crate' | 'sinner' | 'statue' | 'snack' | 'powerup' | 'urn'
  powerup?: PowerupKind
}

const LABELS: Record<Entry['kind'], string> = {
  crate: 'Crate broken',
  sinner: "Sinner's Sacrifice broken",
  statue: 'Golden statue broken',
  snack: 'Healing snack eaten',
  powerup: 'Powerup taken',
  urn: 'Urn delivered',
}

function Glyph({ kind, powerup }: { kind: Entry['kind']; powerup?: PowerupKind }) {
  if (kind === 'powerup') return <PowerupGlyph kind={powerup ?? 'gun'} size={13} />
  if (kind === 'crate') return <CrateGlyph size={8} />
  if (kind === 'sinner') return <SinnerGlyph up size={12} />
  if (kind === 'statue') return <StatueGlyph size={12} />
  if (kind === 'snack') return <SnackGlyph size={11} />
  return <UrnGlyph size={14} />
}

export function MapActivityTab({
  timeline,
  player,
  at,
}: {
  timeline: Timeline
  player: number
  at: number
}) {
  // A whole second is fine enough: none of these happen more than a few times a minute.
  const second = Math.floor(at)
  const entries = useMemo(() => {
    const out: Entry[] = [
      ...breaksBy(timeline, player, second),
      ...urnsDeliveredBy(timeline, player, second).map((seconds) => ({
        seconds,
        kind: 'urn' as const,
      })),
    ]
    return out.sort((a, b) => b.seconds - a.seconds)
  }, [timeline, player, second])

  const count = (kind: Entry['kind']) => entries.filter((e) => e.kind === kind).length
  const totals: [Entry['kind'], string][] = [
    ['crate', 'Crates'],
    ['sinner', "Sinner's Sacrifices"],
    ['statue', 'Golden statues'],
    ['powerup', 'Powerups'],
    ['urn', 'Urns delivered'],
  ]
  // Snacks only exist from the 2026-10 update on.
  if (timeline.events.snacks.t.length) totals.splice(3, 0, ['snack', 'Healing snacks'])

  return (
    <div className="space-y-4 px-3 py-3">
      <dl className="grid grid-cols-2 gap-2">
        {totals.map(([kind, label]) => (
          <div key={kind} className="bg-ui-raised rounded-ui px-2 py-1.5">
            <dt className="fact-label flex items-center gap-1.5">
              <Glyph kind={kind} />
              <span className="truncate">{label}</span>
            </dt>
            <dd className="text-ui-fg mt-0.5 text-[1.125rem] leading-none font-semibold">
              {count(kind)}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h4 className="fact-label mb-1.5">Latest</h4>
        {entries.length === 0 ? (
          <p className="text-ui-muted text-[0.75rem]">Nothing taken from the map yet.</p>
        ) : (
          <ol className="space-y-0.5">
            {entries.slice(0, RECENT).map((entry, i) => (
              <li
                key={`${entry.seconds}-${entry.kind}-${i}`}
                className="flex items-center gap-2 text-[0.75rem]"
              >
                <span className="text-ui-muted w-9 shrink-0">{gameClock(timeline, entry.seconds)}</span>
                <span className="flex w-4 justify-center">
                  <Glyph kind={entry.kind} powerup={entry.powerup} />
                </span>
                <span className="text-ui-fg">
                  {entry.powerup ? `${POWERUP_NAMES[entry.powerup]} powerup taken` : LABELS[entry.kind]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="text-ui-muted text-[0.6875rem]">
        Crates, Golden Statues, Healing Snacks and powerups go to the nearest hero when they
        broke or were taken, so their counts are a close estimate.
      </p>
    </div>
  )
}
