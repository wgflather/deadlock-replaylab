import { useMemo, useState } from 'react'
import {
  liveStats,
  RECENT_RANGE_SECONDS,
  ranked,
  type StatId,
  type StatRange,
  type StatUnit,
} from '../demo/liveStats'
import { AMBER, type Timeline } from '../demo/types'
import { heroIcon } from '../heroes'

/**
 * Every hero ranked by one stat at the playhead, beside the map -- laid out the way a
 * spectator overlay ranks net worth: the hero's face and level, their name, and the
 * stat as a bar in their team's colour, longest at the top. Any stat can be the one
 * ranked, as a total or per minute, over the match or only its last few minutes. See
 * ../demo/liveStats for how each figure is worked out.
 */

const STATS: { id: StatId; label: string }[] = [
  { id: 'netWorth', label: 'Net worth' },
  { id: 'heroDamage', label: 'Hero damage' },
  { id: 'objectiveDamage', label: 'Obj damage' },
  { id: 'healing', label: 'Healing' },
  { id: 'lastHits', label: 'Last hits' },
]

const UNITS: [StatUnit, string][] = [
  ['total', 'Total'],
  ['perMin', 'Per min'],
]

const RANGES: [StatRange, string][] = [
  ['match', 'Match'],
  ['recent', `Last ${RECENT_RANGE_SECONDS / 60} min`],
]

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })

function format(value: number, unit: StatUnit) {
  if (unit === 'perMin' && value < 10) return value.toFixed(1)
  return whole.format(value)
}

/** Two options side by side, the chosen one raised. */
function Toggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: [T, string][]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="bg-ui-inset rounded-ui flex p-0.5"
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded-[4px] px-1.5 py-0.5 text-[0.6875rem] whitespace-nowrap transition-colors ${
            value === id ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function LiveStats({
  timeline,
  at,
  selected,
  onSelect,
  onClose,
}: {
  timeline: Timeline
  at: number
  selected: number | null
  onSelect: (player: number | null) => void
  onClose: () => void
}) {
  const [stat, setStat] = useState<StatId>('netWorth')
  const [unit, setUnit] = useState<StatUnit>('total')
  const [range, setRange] = useState<StatRange>('match')
  // The table only changes when the scoreboard's own frame does, not on every animation
  // frame of playback.
  const frame = Math.floor(at / timeline.sampleSeconds)
  const rows = useMemo(
    () => ranked(liveStats(timeline, frame * timeline.sampleSeconds, stat, unit, range)),
    [timeline, frame, stat, unit, range],
  )
  // Bars are against the leader, so the top row always reaches the end.
  const lead = Math.max(...rows.map((row) => row.value), 0)

  return (
    <section aria-label="Live stats" className="ui-panel flex min-h-0 flex-col overflow-hidden">
      <div className="section-band flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <Toggle label="Unit" options={UNITS} value={unit} onChange={setUnit} />
        <Toggle label="Range" options={RANGES} value={range} onChange={setRange} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide live stats"
          title="Hide live stats"
          className="text-ui-muted hover:text-ui-fg ml-auto px-1 text-[0.9375rem] leading-none"
        >
          ×
        </button>
      </div>

      {/* The column band: dark, as over the rows of an overlay, with the ranked stat
          chosen where its heading is. */}
      <div className="bg-ui-inset border-ui-line grid grid-cols-[3rem_5.5rem_1fr] items-center gap-2 border-b px-2 py-1.5 text-[0.75rem] font-semibold">
        <span className="text-ui-fg">Hero</span>
        <span className="text-ui-fg">Player</span>
        <label className="flex min-w-0 items-center gap-1">
          <span className="sr-only">Rank by</span>
          <select
            value={stat}
            onChange={(event) => setStat(event.target.value as StatId)}
            className="text-ui-fg hover:bg-ui-raised rounded-ui min-w-0 cursor-pointer bg-transparent py-0.5 pr-1 font-semibold"
          >
            {STATS.map((option) => (
              <option key={option.id} value={option.id} className="bg-ui-raised">
                {option.label}
                {unit === 'perMin' ? '/min' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ol className="min-h-0 overflow-y-auto">
        {rows.map((row) => {
          const player = timeline.players[row.player]
          const isSelected = selected === row.player
          const team = row.team === AMBER ? 'var(--data-team-amber)' : 'var(--data-team-sapphire)'
          const icon = heroIcon(player.heroId)
          const share = lead > 0 ? (row.value / lead) * 100 : 0
          return (
            <li key={row.player} className="border-ui-line border-b last:border-0">
              <button
                type="button"
                aria-pressed={isSelected}
                title={`${player.name} — click to inspect`}
                onClick={() => onSelect(isSelected ? null : row.player)}
                className={`grid w-full grid-cols-[3rem_5.5rem_1fr] items-center gap-2 px-2 py-1 text-left transition-[opacity,background-color] ${
                  row.alive ? '' : 'opacity-60'
                } ${isSelected ? 'bg-ui-raised' : 'hover:bg-ui-raised/60'}`}
                style={{
                  // A wash of the team's colour from the left, as the overlay tints its
                  // rows -- and the application's cream edge on the one selected.
                  backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${team} 16%, transparent), transparent 75%)`,
                  boxShadow: isSelected ? 'inset 2px 0 0 var(--ui-accent)' : undefined,
                }}
              >
                {/* The face, with the level in its corner. */}
                <span className="frame rounded-ui relative block h-7 w-12 overflow-hidden">
                  {icon && (
                    <img
                      src={icon}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover object-[50%_25%]"
                    />
                  )}
                  <span className="bg-ui-inset/85 text-ui-fg absolute bottom-0 left-0 rounded-tr-[4px] px-1 text-[0.625rem] leading-[1.35] font-semibold tabular-nums">
                    {row.level}
                  </span>
                </span>

                <span className="text-ui-fg min-w-0 truncate text-[0.75rem] font-medium">
                  {player.name}
                </span>

                {/* The stat: a bar in the team's colour with a light cap at its end, the
                    figure over its start. */}
                <span className="relative flex h-6 min-w-0 items-center">
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-0 h-[7px] -translate-y-1/2 rounded-full transition-[width] duration-300"
                    style={{
                      width: `${share}%`,
                      background: `linear-gradient(90deg, color-mix(in srgb, ${team} 35%, black), ${team})`,
                      boxShadow: share > 0 ? 'inset -3px 0 0 var(--ui-fg)' : undefined,
                    }}
                  />
                  <span
                    className="relative text-[0.875rem] font-bold tabular-nums"
                    style={{
                      color: stat === 'netWorth' ? 'var(--data-statue)' : 'var(--ui-fg)',
                      textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.7)',
                    }}
                  >
                    {format(row.value, unit)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
