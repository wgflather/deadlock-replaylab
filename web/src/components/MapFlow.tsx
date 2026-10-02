import { useMemo } from 'react'
import {
  duration,
  FLOW_STEP,
  schedule,
  tracks,
  upcoming,
  type Track,
} from '../demo/mapFlow'
import type { ScheduleRow } from '../demo/mapFlow'
import { campHistories } from '../demo/mapState'
import type { Timeline } from '../demo/types'
import { gameClock, gameSeconds, recordingSeconds } from '../demo/usePlayback'

/**
 * The map on its own, beside a map drawn without players: what is coming up next, when
 * each thing first appears and how soon it comes back, and a strip per thing over the
 * whole match -- for learning the map's rhythm rather than watching a fight. Every figure
 * is read off this replay; nothing is written down from a wiki, so a patch that moves a
 * timer moves it here too.
 */

/** The strips' viewBox width: a position is its share of the match times this. */
const VIEW = 1000

/** Anything due within this many seconds of game clock is called out. */
const SOON = 30

export function MapFlow({
  timeline,
  at,
  onSeek,
  rules,
  rulesNote,
  clock = false,
  strips: showStrips = true,
}: {
  timeline: Timeline
  at: number
  /** Jump to a frame, as the playback bar does. */
  onSeek: (frame: number) => void
  /** A schedule to show instead of the one measured off `timeline`, and what to say
   * under it -- the map timings page, which has no real match to measure. */
  rules?: ScheduleRow[]
  rulesNote?: string
  /** Lead with the game clock, large, and what is next on it -- the clock is what a
   * player keeps an eye on in a match. */
  clock?: boolean
  /** Whether to show the strips over the whole match. */
  strips?: boolean
}) {
  const measured = useMemo(() => (rules ? null : schedule(timeline)), [timeline, rules])
  const rows = rules ?? measured ?? []
  const strips = useMemo(() => tracks(timeline), [timeline])
  const camps = useMemo(() => campHistories(timeline), [timeline])
  const next = upcoming(timeline, at, camps)
  const end = timeline.duration
  const now = gameSeconds(timeline, at)
  const seek = (seconds: number) =>
    onSeek(Math.max(0, Math.min(timeline.frames - 1, Math.round(seconds / timeline.sampleSeconds))))

  const soonest = next[0]
  const inSoonest = soonest ? gameSeconds(timeline, soonest.at) - now : null
  return (
    <section aria-label="Map flow" className="ui-panel flex min-h-0 flex-col gap-4 overflow-y-auto p-3">
      {clock && (
        <div className="border-ui-line flex items-end justify-between gap-3 border-b pb-3">
          <div>
            <p className="fact-label">Game clock</p>
            <p className="text-ui-fg text-[2.75rem] leading-none font-semibold tabular-nums">
              {gameClock(timeline, at)}
            </p>
          </div>
          {soonest && inSoonest !== null && (
            <div className="min-w-0 text-right">
              <p className="fact-label">Next</p>
              <p className={`truncate text-[0.875rem] ${inSoonest <= SOON ? 'text-ui-accent' : 'text-ui-fg'}`}>
                {soonest.label}
              </p>
              <p className="text-ui-muted text-[0.8125rem] tabular-nums">
                at {gameClock(timeline, soonest.at)} · in {duration(inSoonest)}
              </p>
            </div>
          )}
        </div>
      )}
      <div>
        <h2 className="section-title mb-1.5">Coming up</h2>
        {next.length === 0 ? (
          <p className="text-ui-muted text-[0.75rem]">Nothing else comes up in this match.</p>
        ) : (
          <ol className="space-y-0.5 text-[0.75rem]">
            {next.map((item) => {
              const soon = gameSeconds(timeline, item.at) - now <= SOON
              return (
              <li key={item.label + item.at} className={`flex items-baseline gap-2 ${soon ? 'text-ui-accent' : ''}`}>
                <button
                  type="button"
                  onClick={() => seek(item.at)}
                  className="text-ui-muted hover:text-ui-fg w-10 shrink-0 text-left tabular-nums"
                  title="Jump there"
                >
                  {gameClock(timeline, item.at)}
                </button>
                <span className={`min-w-0 flex-1 truncate ${soon ? '' : 'text-ui-fg'}`}>{item.label}</span>
                <span className={`tabular-nums ${soon ? '' : 'text-ui-muted'}`}>
                  in {duration(gameSeconds(timeline, item.at) - now)}
                </span>
              </li>
              )
            })}
          </ol>
        )}
      </div>

      <div>
        <h2 className="section-title mb-1.5">Schedule</h2>
        <table className="w-full text-[0.75rem]">
          <thead>
            <tr className="text-left">
              <th className="fact-label pb-1 font-normal">What</th>
              <th className="fact-label pb-1 font-normal">First</th>
              <th className="fact-label pb-1 font-normal">Comes back</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="align-baseline">
                <td className="text-ui-fg py-0.5 pr-2">{row.label}</td>
                <td className="text-ui-fg py-0.5 pr-2 whitespace-nowrap tabular-nums">
                  {row.firstText ?? (row.first === null ? '–' : gameClock(timeline, row.first))}
                </td>
                <td className="text-ui-muted py-0.5">{row.again ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-ui-faint mt-1 text-[0.6875rem]">
          {rulesNote ??
            'Measured in this match, on the game clock. Respawns are the usual delay; a few things come back on their own timer whatever happens.'}
        </p>
      </div>

      {showStrips && (
        <div>
          <h2 className="section-title mb-1.5">Over the match</h2>
          <Strips timeline={timeline} strips={strips} at={at} end={end} onSeek={seek} />
        </div>
      )}
    </section>
  )
}

function Strips({
  timeline,
  strips,
  at,
  end,
  onSeek,
}: {
  timeline: Timeline
  strips: Track[]
  at: number
  end: number
  onSeek: (seconds: number) => void
}) {
  const x = (seconds: number) => (Math.max(0, Math.min(end, seconds)) / end) * VIEW
  // A tick every five minutes of game clock -- ten past 40 minutes, where five would
  // crowd a side panel -- placed where the recording reached it.
  const lastMinute = Math.floor(gameSeconds(timeline, end) / 60)
  const every = lastMinute > 40 ? 10 : 5
  const ticks: { label: string; left: number }[] = []
  for (let m = 0; m <= lastMinute; m += every)
    ticks.push({ label: `${m}:00`, left: recordingSeconds(timeline, m * 60) / end })

  return (
    <div className="flex gap-2 text-[0.6875rem]">
      <div className="flex w-[6.5rem] shrink-0 flex-col gap-1">
        {strips.map((strip) => (
          <span key={strip.id} className="text-ui-muted h-4 truncate leading-4" title={strip.label}>
            {strip.label}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-col gap-1">
          {strips.map((strip) => (
            <Strip key={strip.id} strip={strip} x={x} end={end} onSeek={onSeek} />
          ))}
        </div>
        <div className="relative mt-0.5 h-4">
          {ticks.map((tick) => (
            <span
              key={tick.label}
              className="text-ui-faint absolute top-0 -translate-x-1/2 tabular-nums"
              style={{ left: `${tick.left * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        {/* The playhead, over every strip at once. */}
        <span
          aria-hidden="true"
          className="bg-ui-accent pointer-events-none absolute top-0 bottom-5 w-px"
          style={{ left: `${(Math.min(at, end) / end) * 100}%` }}
        />
      </div>
    </div>
  )
}

function Strip({
  strip,
  x,
  end,
  onSeek,
}: {
  strip: Track
  x: (seconds: number) => number
  end: number
  onSeek: (seconds: number) => void
}) {
  const level = strip.level
  const area =
    level &&
    `M0,10 ${level.values.map((v, k) => `L${x(k * FLOW_STEP)},${10 - v * 9}`).join(' ')} L${x(end)},10 Z`
  return (
    <svg
      viewBox={`0 0 ${VIEW} 10`}
      preserveAspectRatio="none"
      aria-label={strip.label}
      className="bg-ui-inset block h-4 w-full cursor-pointer rounded-[3px]"
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        onSeek(((event.clientX - box.left) / box.width) * end)
      }}
    >
      {area && <path d={area} style={{ fill: level.colour }} fillOpacity={0.55} />}
      {strip.spans.map((span, i) => (
        <rect
          key={i}
          x={x(span.from)}
          y={1.5}
          width={Math.max(1, x(span.to) - x(span.from))}
          height={7}
          style={{ fill: span.colour }}
          fillOpacity={span.faint ? 0.35 : 0.9}
        >
          <title>{span.title}</title>
        </rect>
      ))}
      {strip.marks.map((mark, i) => (
        <line
          key={i}
          x1={x(mark.at)}
          x2={x(mark.at)}
          y1={0.5}
          y2={9.5}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          style={{ stroke: mark.colour }}
        >
          <title>{mark.title}</title>
        </line>
      ))}
    </svg>
  )
}
