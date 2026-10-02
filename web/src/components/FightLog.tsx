import { useMemo, useState } from 'react'
import { fightLabel, findFights, type Fight, type FightKind, type FightSide } from '../demo/fights'
import { AMBER, SAPPHIRE, type Timeline } from '../demo/types'
import { gameClock } from '../demo/usePlayback'
import { HeroFace } from './HeroIcon'
import type { MapFocus } from './MapView'

/**
 * Every fight in the match, in order, under the live stats: when it was, how big, who
 * was in it on each side and how it went. Clicking one takes the playhead to just
 * before it started and the map to where it was fought. See ../demo/fights for how fights are found.
 */

/** Seconds before a fight's first hit that clicking it seeks to: enough to see it start. */
const LEAD_IN = 3

const FILTERS = [
  ['all', 'All'],
  ['lane', 'Lane'],
  ['skirmish', 'Skirmish'],
  ['teamfight', 'Team'],
] as const

/** What each kind of fight is called in its row: a prefix to its size, and its tone. */
const KIND_NAMES: Record<FightKind, { short: string; long: string; tone: string }> = {
  lane: { short: 'Lane', long: 'Lane fight', tone: 'text-ui-faint' },
  skirmish: { short: '', long: 'Skirmish', tone: 'text-ui-muted' },
  teamfight: { short: 'TF', long: 'Team fight', tone: 'text-ui-accent' },
}

const teamColour = (team: number) =>
  team === AMBER ? 'var(--data-team-amber)' : 'var(--data-team-sapphire)'

export function FightLog({
  timeline,
  at,
  onSeek,
  onFocus,
}: {
  timeline: Timeline
  at: number
  /** Takes a scoreboard frame, as the playback bar's seek does. */
  onSeek: (frame: number) => void
  /** Frames a fight on the map: its centre and radius in world units. */
  onFocus: (focus: MapFocus) => void
}) {
  const fights = useMemo(() => findFights(timeline), [timeline])
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all')
  const shown = filter === 'all' ? fights : fights.filter((f) => f.kind === filter)

  // Team fights won by each side, over the ones already fought. The first side is always
  // amber, the Hidden King's: teams are in number order.
  const won = [0, 0]
  for (const fight of fights) {
    if (fight.kind === 'teamfight' && fight.start <= at && fight.winner >= 0) won[fight.winner]++
  }

  return (
    <section aria-label="Fights" className="ui-panel flex min-h-0 flex-col overflow-hidden">
      <div className="section-band flex items-center gap-1.5 px-2 py-1.5">
        <h3 className="text-ui-fg text-[0.8125rem] font-semibold">Fights</h3>
        <div role="radiogroup" aria-label="Show" className="bg-ui-inset rounded-ui flex p-0.5">
          {FILTERS.map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={filter === id}
              onClick={() => setFilter(id)}
              className={`rounded-[4px] px-1.5 py-0.5 text-[0.6875rem] whitespace-nowrap transition-colors ${
                filter === id ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
        <span
          className="ml-auto text-[0.75rem] font-semibold tabular-nums"
          title="Team fights won so far"
        >
          <span style={{ color: teamColour(AMBER) }}>{won[0]}</span>
          <span className="text-ui-muted"> – </span>
          <span style={{ color: teamColour(SAPPHIRE) }}>{won[1]}</span>
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="text-ui-muted px-3 py-3 text-[0.75rem]">No fights found.</p>
      ) : (
        <ol className="min-h-0 overflow-y-auto">
          {shown.map((fight) => (
            <FightRow
              key={fight.start}
              fight={fight}
              timeline={timeline}
              state={at < fight.start ? 'ahead' : at <= fight.end ? 'now' : 'past'}
              onSeek={() => {
                onSeek(Math.floor(Math.max(0, fight.start - LEAD_IN) / timeline.sampleSeconds))
                onFocus({ x: fight.x, y: fight.y, radius: fight.radius })
              }}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

function FightRow({
  fight,
  timeline,
  state,
  onSeek,
}: {
  fight: Fight
  timeline: Timeline
  /** Where the playhead is: before it, in it, or past it. */
  state: 'ahead' | 'now' | 'past'
  onSeek: () => void
}) {
  const [a, b] = fight.sides
  const winner = fight.winner >= 0 ? fight.sides[fight.winner] : undefined
  const name = KIND_NAMES[fight.kind]
  return (
    <li className="border-ui-line border-b last:border-0">
      <button
        type="button"
        onClick={onSeek}
        title={`${name.long} ${fightLabel(fight)} at ${gameClock(timeline, fight.start)}, ${Math.round(fight.end - fight.start)}s — click to watch`}
        className={`grid w-full grid-cols-[2.5rem_4.25rem_1fr_2.75rem_1fr] items-center gap-1.5 px-2 py-1 text-left transition-[opacity,background-color] ${
          state === 'now' ? 'bg-ui-raised' : 'hover:bg-ui-raised/60'
        } ${state === 'ahead' ? 'opacity-60' : ''}`}
        style={{
          // The winning side's colour along the left edge; none for an even fight.
          boxShadow: winner ? `inset 2px 0 0 ${teamColour(winner.team)}` : undefined,
        }}
      >
        <span className="text-ui-muted text-[0.6875rem] tabular-nums">
          {gameClock(timeline, fight.start)}
        </span>
        <span className={`truncate text-[0.6875rem] font-semibold ${name.tone}`}>
          {name.short} {fightLabel(fight)}
        </span>
        <Faces side={a} timeline={timeline} align="end" />
        <span className="text-center text-[0.75rem] font-bold tabular-nums">
          <span style={{ color: teamColour(a.team) }}>{a.kills}</span>
          <span className="text-ui-muted"> – </span>
          <span style={{ color: teamColour(b.team) }}>{b.kills}</span>
        </span>
        <Faces side={b} timeline={timeline} align="start" />
      </button>
    </li>
  )
}

function Faces({
  side,
  timeline,
  align,
}: {
  side: FightSide
  timeline: Timeline
  align: 'start' | 'end'
}) {
  return (
    <span
      className={`flex min-w-0 flex-wrap gap-px ${align === 'end' ? 'justify-end' : ''}`}
      title={side.players.map((p) => timeline.players[p].name).join(', ')}
    >
      {side.players.map((p) => (
        <HeroFace key={p} player={timeline.players[p]} size={16} />
      ))}
    </span>
  )
}
