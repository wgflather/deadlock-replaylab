import { useEffect, useMemo, useRef, useState } from 'react'
import { SOURCE_LABELS } from '../demo/income'
import { averageOf, METRICS, metricValues, niceTicks, type MetricId } from '../demo/performance'
import type { IncomeSource } from '../demo/types'
import { AMBER, SAPPHIRE, type Player, type Timeline } from '../demo/types'
import { gameClock, recordingSeconds } from '../demo/usePlayback'
import { compact } from '../stats/format'
import { HeroFace } from './HeroIcon'

/**
 * Performance over time: one metric at a time, one line per player, for the whole match.
 *
 * Twelve players are more lines than hues can tell apart, so colour here says *team*,
 * the one thing it already means in this app, and emphasis says *who*: the player open
 * in the inspector is drawn thick and solid, everyone else thin and faded. Averages --
 * the match's, and each team's -- are dashed, the benchmark look, in the average colour
 * or their team's. Identity never rests on colour alone: the focused line ends in the
 * hero's face, the legend below is faces, and the tooltip names every line at the
 * crosshair. A table view gives every value without hovering.
 *
 * The playhead is the application's own state, drawn in its accent; clicking anywhere on
 * the chart moves it there.
 *
 * It opens quiet: the match average and each team's leader by final net worth, plus the
 * player open in the inspector. A dozen lines at once is a tangle; the legend adds the
 * rest one at a time.
 */

const TEAMS = [
  { id: AMBER, name: 'Amber Hand', colour: 'var(--data-team-amber)' },
  { id: SAPPHIRE, name: 'Sapphire Flame', colour: 'var(--data-team-sapphire)' },
] as const

type AverageId = 'match' | 'amber' | 'sapphire'
const AVERAGES: { id: AverageId; label: string; colour: string; team?: number }[] = [
  { id: 'match', label: 'Match average', colour: 'var(--data-average)' },
  { id: 'amber', label: 'Amber average', colour: 'var(--data-team-amber)', team: AMBER },
  {
    id: 'sapphire',
    label: 'Sapphire average',
    colour: 'var(--data-team-sapphire)',
    team: SAPPHIRE,
  },
]

/** Plot margins in pixels: room for the y ticks on the left and the end face on the right. */
const M = { top: 12, right: 30, bottom: 26, left: 48 }

/** Each team's top player by net worth at the end of the match. */
function leaders(timeline: Timeline): number[] {
  const last = timeline.frames - 1
  return [AMBER, SAPPHIRE].flatMap((team) => {
    let best = -1
    timeline.players.forEach((p, i) => {
      if (p.team !== team) return
      const worth = timeline.series.netWorth[i]?.[last] ?? 0
      if (best < 0 || worth > (timeline.series.netWorth[best]?.[last] ?? 0)) best = i
    })
    return best < 0 ? [] : [best]
  })
}

type Series = {
  key: string
  label: string
  colour: string
  values: number[]
  /** The player, for a player's line. */
  player?: Player
  average?: boolean
  focus?: boolean
}

function teamColour(team: number) {
  return team === AMBER ? 'var(--data-team-amber)' : 'var(--data-team-sapphire)'
}

/** A value as the chart shows it: whole, and short once it is large. */
function format(value: number) {
  return compact(Math.round(value))
}

export function PerformanceChart({
  timeline,
  at,
  focus,
  onSeek,
}: {
  timeline: Timeline
  /** The playhead, in match seconds. */
  at: number
  /** The player open in the inspector, whose line leads. */
  focus: number | null
  onSeek: (frame: number) => void
}) {
  const [metric, setMetric] = useState<MetricId>('netWorth')
  const [source, setSource] = useState<IncomeSource>('lane')
  const [shown, setShown] = useState<Set<number>>(() => {
    const start = new Set(leaders(timeline))
    if (focus !== null) start.add(focus)
    return start
  })
  // Opening a player in the inspector puts them on the chart. Adjusted during render
  // rather than in an effect, so the line is there on the same frame the panel opens;
  // hiding them again from the legend is still up to the reader.
  const [seenFocus, setSeenFocus] = useState(focus)
  if (seenFocus !== focus) {
    setSeenFocus(focus)
    if (focus !== null && !shown.has(focus)) setShown(new Set(shown).add(focus))
  }
  const [averages, setAverages] = useState<Set<AverageId>>(new Set(['match']))
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const plotRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [asTable])

  const players = timeline.players
  const values = useMemo(() => metricValues(timeline, metric, source), [timeline, metric, source])
  const series: Series[] = useMemo(() => {
    const out: Series[] = []
    for (const avg of AVERAGES) {
      if (!averages.has(avg.id)) continue
      const group = players
        .map((_, i) => i)
        .filter((i) => avg.team === undefined || players[i].team === avg.team)
      const line = averageOf(values, group)
      if (line)
        out.push({ key: avg.id, label: avg.label, colour: avg.colour, values: line, average: true })
    }
    for (const i of players.map((_, i) => i).filter((i) => shown.has(i))) {
      out.push({
        key: `p${i}`,
        label: players[i].name,
        colour: teamColour(players[i].team),
        values: values[i] ?? [],
        player: players[i],
        focus: i === focus,
      })
    }
    return out
  }, [values, averages, shown, focus, players])

  const frames = timeline.frames
  const duration = Math.max(timeline.duration, 1)
  const max = Math.max(1, ...series.flatMap((s) => [Math.max(...s.values)]))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]

  const innerW = Math.max(0, size.width - M.left - M.right)
  const innerH = Math.max(0, size.height - M.top - M.bottom)
  const x = (seconds: number) => M.left + (seconds / duration) * innerW
  const y = (value: number) => M.top + innerH - (value / top) * innerH

  // One point per pixel at most: a match has two thousand frames and the plot is a
  // thousand pixels wide, so drawing every frame buys nothing but path length.
  const stride = Math.max(1, Math.floor(frames / Math.max(innerW, 1)))
  const path = (column: number[]) => {
    let d = ''
    for (let f = 0; f < column.length; f += stride) {
      d += `${d ? 'L' : 'M'}${x(f * timeline.sampleSeconds).toFixed(1)} ${y(column[f]).toFixed(1)}`
    }
    const last = column.length - 1
    if (last >= 0 && last % stride !== 0)
      d += `L${x(last * timeline.sampleSeconds).toFixed(1)} ${y(column[last]).toFixed(1)}`
    return d
  }

  // Ticks on round minutes of the in-game clock, which starts some way into the
  // recording and stops for pauses: a tick at "10:00" is where the players' clock read
  // 10:00.
  const minuteStep = duration > 1800 ? 10 : 5
  const xTicks: number[] = []
  for (let m = 0; recordingSeconds(timeline, m * 60) <= duration; m += minuteStep) {
    xTicks.push(recordingSeconds(timeline, m * 60))
  }

  const frameAt = (clientX: number) => {
    const box = plotRef.current?.getBoundingClientRect()
    if (!box) return null
    const seconds = ((clientX - box.left - M.left) / innerW) * duration
    return Math.max(0, Math.min(frames - 1, Math.round(seconds / timeline.sampleSeconds)))
  }

  // Players are drawn under the focus and the averages, so emphasis is never buried.
  const drawOrder = [...series].sort(
    (a, b) => Number(!!a.focus || !!a.average) - Number(!!b.focus || !!b.average),
  )
  const anyFocus = focus !== null && shown.has(focus)

  const toggle = (i: number) =>
    setShown((was) => {
      const next = new Set(was)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  const setTeam = (team: number, visible: boolean) =>
    setShown((was) => {
      const next = new Set(was)
      players.forEach((p, i) => {
        if (p.team !== team) return
        if (visible) next.add(i)
        else next.delete(i)
      })
      return next
    })

  const playFrame = Math.min(frames - 1, Math.floor(at / timeline.sampleSeconds))
  const readFrame = hover ?? playFrame
  const readout = [...series].sort(
    (a, b) => (b.values[readFrame] ?? 0) - (a.values[readFrame] ?? 0),
  )
  const focusSeries = series.find((s) => s.focus)
  const note = METRICS.find((m) => m.id === metric)?.note

  return (
    <section
      aria-label="Performance over time"
      className="ui-panel flex h-full min-h-[28rem] flex-col overflow-hidden"
    >
      {/* Filters: one row, above what they scope. */}
      <div className="border-ui-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
        <div role="radiogroup" aria-label="Metric" className="flex flex-wrap gap-0.5">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={`rounded-[4px] px-2 py-1 text-[0.75rem] transition-colors ${
                metric === m.id ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {metric === 'income' && (
          <label className="flex items-center gap-1.5 text-[0.75rem]">
            <span className="text-ui-muted">Source</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as IncomeSource)}
              className="bg-ui-surface text-ui-fg border-ui-line-strong rounded-[4px] border px-1 py-0.5"
            >
              {timeline.income.sources.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((was) => !was)}
          className={`ui-button ml-auto px-2 py-1 text-[0.75rem] ${asTable ? 'bg-ui-raised text-ui-fg' : ''}`}
        >
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {asTable ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <p className="text-ui-muted mb-2 text-[0.75rem]">
            {METRICS.find((m) => m.id === metric)?.label}
            {metric === 'income' && ` ${SOURCE_LABELS[source].toLowerCase()}`} at{' '}
            {gameClock(timeline, playFrame * timeline.sampleSeconds)}
          </p>
          <table className="w-full max-w-md text-left text-[0.8125rem]">
            <tbody>
              {[...series]
                .sort((a, b) => (b.values[playFrame] ?? 0) - (a.values[playFrame] ?? 0))
                .map((s) => (
                  <tr key={s.key} className="border-ui-line border-b last:border-0">
                    <td className="py-1.5 pr-3">
                      <span className="flex items-center gap-2">
                        <LineKey colour={s.colour} dashed={s.average} />
                        <span className={s.average ? 'text-ui-muted' : 'text-ui-fg'}>
                          {s.label}
                        </span>
                      </span>
                    </td>
                    <td className="text-ui-fg py-1.5 text-right tabular-nums">
                      {format(s.values[playFrame] ?? 0)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={plotRef}
          className="relative min-h-0 flex-1 cursor-crosshair"
          onPointerMove={(event) => setHover(frameAt(event.clientX))}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => {
            const frame = frameAt(event.clientX)
            if (frame !== null) onSeek(frame)
          }}
        >
          {size.width > 0 && (
            <svg
              width={size.width}
              height={size.height}
              className="absolute inset-0"
              aria-hidden="true"
            >
              {/* Gridlines and ticks: hairline, solid, one step off the surface. */}
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={M.left}
                    x2={M.left + innerW}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="var(--ui-line)"
                  />
                  <text
                    x={M.left - 8}
                    y={y(t)}
                    dy="0.32em"
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--ui-muted)"
                  >
                    {compact(t)}
                  </text>
                </g>
              ))}
              {xTicks.map((t) => (
                <text
                  key={t}
                  x={x(t)}
                  y={M.top + innerH + 17}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--ui-muted)"
                >
                  {gameClock(timeline, t)}
                </text>
              ))}

              {drawOrder.map((s) => (
                <path
                  key={s.key}
                  d={path(s.values)}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.average ? '6 4' : undefined}
                  style={{
                    stroke: s.colour,
                    strokeWidth: s.focus ? 2.5 : s.average ? 2 : anyFocus ? 1.25 : 1.75,
                    opacity: s.focus || s.average || !anyFocus ? 1 : 0.4,
                  }}
                />
              ))}

              {/* The playhead: where the replay is. */}
              <line
                x1={x(at)}
                x2={x(at)}
                y1={M.top}
                y2={M.top + innerH}
                style={{ stroke: 'var(--ui-accent)' }}
                strokeWidth={1.5}
              />

              {/* The crosshair, snapped to the nearest second. */}
              {hover !== null && (
                <line
                  x1={x(hover * timeline.sampleSeconds)}
                  x2={x(hover * timeline.sampleSeconds)}
                  y1={M.top}
                  y2={M.top + innerH}
                  stroke="var(--ui-line-strong)"
                />
              )}
              {hover !== null &&
                series.map((s) => (
                  <circle
                    key={s.key}
                    cx={x(hover * timeline.sampleSeconds)}
                    cy={y(s.values[hover] ?? 0)}
                    r={s.focus ? 4 : 3}
                    style={{ fill: s.colour, stroke: 'var(--ui-surface)' }}
                    strokeWidth={2}
                  />
                ))}
            </svg>
          )}

          {/* The focused line ends in its hero's face: identity by picture, not colour. */}
          {focusSeries?.player && size.width > 0 && (
            <span
              className="pointer-events-none absolute"
              style={{
                left: x(duration) + 4,
                top: y(focusSeries.values[focusSeries.values.length - 1] ?? 0) - 9,
              }}
            >
              <HeroFace player={focusSeries.player} size={18} />
            </span>
          )}

          {hover !== null && size.width > 0 && (
            <Readout
              timeline={timeline}
              left={x(hover * timeline.sampleSeconds)}
              width={size.width}
              seconds={hover * timeline.sampleSeconds}
              rows={readout.map((s) => ({ series: s, value: format(s.values[hover] ?? 0) }))}
            />
          )}
        </div>
      )}

      {note && <p className="text-ui-muted px-3 pb-1 text-[0.6875rem]">{note}</p>}

      {/* The legend is the player switch: every player, by team, on or off. */}
      <div className="border-ui-line grid gap-2 border-t px-3 py-2 xl:grid-cols-[1fr_1fr_auto]">
        {TEAMS.map((team) => {
          const members = players.map((p, i) => ({ p, i })).filter(({ p }) => p.team === team.id)
          return (
            <div
              key={team.id}
              role="group"
              aria-label={`${team.name} players`}
              className="flex flex-wrap items-center gap-1"
            >
              <span className="text-ui-muted mr-1 flex items-center gap-1.5 text-[0.75rem]">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: team.colour }}
                />
                {team.name}
              </span>
              {members.map(({ p, i }) => {
                const on = shown.has(i)
                return (
                  <button
                    key={p.slot}
                    type="button"
                    aria-pressed={on}
                    title={`${on ? 'Hide' : 'Show'} ${p.name}`}
                    onClick={() => toggle(i)}
                    className={`rounded-full p-0.5 transition-opacity ${on ? '' : 'opacity-35'} ${
                      focus === i ? 'outline-ui-accent outline-1' : ''
                    }`}
                  >
                    <HeroFace player={p} size={22} />
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setTeam(team.id, true)}
                className="text-ui-muted hover:text-ui-fg ml-1 text-[0.6875rem]"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setTeam(team.id, false)}
                className="text-ui-muted hover:text-ui-fg text-[0.6875rem]"
              >
                None
              </button>
            </div>
          )
        })}
        <div role="group" aria-label="Averages" className="flex flex-wrap items-center gap-1">
          {AVERAGES.map((avg) => {
            const on = averages.has(avg.id)
            return (
              <button
                key={avg.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setAverages((was) => {
                    const next = new Set(was)
                    if (next.has(avg.id)) next.delete(avg.id)
                    else next.add(avg.id)
                    return next
                  })
                }
                className={`flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-[0.75rem] transition-colors ${
                  on ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
                }`}
              >
                <LineKey colour={avg.colour} dashed />
                {avg.label}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** A short stroke of a series' colour: how a legend or readout row names its line. */
function LineKey({ colour, dashed }: { colour: string; dashed?: boolean }) {
  return (
    <svg aria-hidden="true" width={16} height={6} className="shrink-0">
      <line
        x1={1}
        x2={15}
        y1={3}
        y2={3}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={dashed ? '4 3' : undefined}
        style={{ stroke: colour }}
      />
    </svg>
  )
}

/**
 * The crosshair's readout: every line at that second, largest first. Values lead and
 * names follow -- the reader already has the line and wants the number. Kept on the
 * side of the crosshair with more room.
 */
function Readout({
  timeline,
  left,
  width,
  seconds,
  rows,
}: {
  timeline: Timeline
  left: number
  width: number
  seconds: number
  rows: { series: Series; value: string }[]
}) {
  const onRight = left < width / 2
  return (
    <div
      role="tooltip"
      className="ui-pop pointer-events-none absolute top-2 z-10 max-h-[calc(100%-1rem)] w-56 overflow-hidden px-2.5 py-2"
      style={onRight ? { left: left + 12 } : { right: width - left + 12 }}
    >
      <p className="text-ui-muted mb-1 text-[0.6875rem]">{gameClock(timeline, seconds)}</p>
      <ul className="space-y-0.5">
        {rows.map(({ series, value }) => (
          <li key={series.key} className="flex items-center gap-2 text-[0.75rem]">
            <LineKey colour={series.colour} dashed={series.average} />
            <span className="text-ui-fg w-12 shrink-0 text-right font-medium tabular-nums">
              {value}
            </span>
            {series.player && <HeroFace player={series.player} size={16} />}
            <span
              className={`truncate ${series.focus ? 'text-ui-fg font-medium' : 'text-ui-muted'}`}
            >
              {series.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
