import { AMBER, SAPPHIRE, spotsAt, type Row, type Spot, type Timeline } from '../demo/types'
import { gameClock } from '../demo/usePlayback'
import { heroPortrait } from '../heroes'
import { compact } from '../stats/format'

/**
 * The match at a glance, across the top of the screen: each side's six heroes either
 * side of the clock, the kill score beside it and the soul lead beneath.
 *
 * The frame around it is neutral; the colour in it is data. A team shows as a thin line
 * of its colour over each of its portraits and in its kill count; health is a bar under
 * the face, blended from the health colour to the damage colour; a dead hero's portrait
 * goes grey. Clicking one opens that player in the inspector, marked with the
 * application's selection outline. The full table is one step away, over the map.
 */

const TEAMS = [
  { id: AMBER, name: 'Amber Hand', colour: 'var(--data-team-amber)' },
  { id: SAPPHIRE, name: 'Sapphire Flame', colour: 'var(--data-team-sapphire)' },
] as const

function Portrait({
  row,
  spot,
  colour,
  selected,
  onClick,
}: {
  row: Row
  spot: Spot | undefined
  colour: string
  selected: boolean
  onClick: () => void
}) {
  const url = heroPortrait(row.heroId)
  // The replay's own health, not the scoreboard's once-a-second alive flag, so the bar
  // drains through a fight as it happens.
  const hp = spot?.hpFraction ?? 0
  const dead = !row.alive || (spot !== undefined && !spot.alive)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${row.name}, level ${row.level}, ${row.kills} kills, ${row.deaths} deaths, ${row.assists} assists${dead ? ', dead' : ''}`}
      title={row.name}
      className={`flex w-[3.25rem] shrink-0 flex-col rounded-[4px] p-0.5 text-left outline-offset-0 transition-colors sm:w-[3.5rem] ${
        selected ? 'outline-ui-accent bg-ui-accent-soft outline-1' : 'hover:bg-ui-raised'
      }`}
    >
      <span
        className="bg-ui-inset relative block h-[3.5rem] overflow-hidden rounded-[3px] border-t-2 sm:h-[3.75rem]"
        style={{ borderTopColor: colour }}
      >
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            className={`h-full w-full object-cover object-top transition-[filter] duration-300 motion-reduce:transition-none ${
              dead ? 'brightness-50 grayscale' : ''
            }`}
          />
        )}
        <span
          aria-hidden="true"
          className="bg-ui-bg/85 text-ui-fg absolute bottom-0 left-0 rounded-tr-[3px] px-1 text-[0.625rem] leading-[1.4] font-medium"
        >
          {row.level}
        </span>
      </span>
      {/* Health: the health colour at full, blending to the damage colour at empty. */}
      <span
        aria-hidden="true"
        className="bg-ui-line mt-0.5 block h-[3px] overflow-hidden rounded-full"
      >
        <span
          className="block h-full"
          style={{
            width: `${dead ? 0 : hp * 100}%`,
            background: `color-mix(in srgb, var(--data-health) ${Math.round(hp * 100)}%, var(--data-damage))`,
          }}
        />
      </span>
      <span aria-hidden="true" className="mt-0.5 flex flex-col items-center leading-tight">
        <span className="text-ui-fg text-[0.6875rem] font-medium">
          {row.kills}/<span className="text-data-death">{row.deaths}</span>/
          <span className="text-ui-muted">{row.assists}</span>
        </span>
        <span className="text-ui-muted text-[0.625rem]">{compact(row.netWorth)}</span>
      </span>
    </button>
  )
}

export function TopHud({
  timeline,
  rows,
  at,
  selected,
  onSelect,
  boardOpen,
  onBoard,
}: {
  timeline: Timeline
  /** The scoreboard at the playhead, in player order. */
  rows: Row[]
  at: number
  selected: number | null
  onSelect: (player: number | null) => void
  boardOpen: boolean
  onBoard: () => void
}) {
  const spots = spotsAt(timeline, at)
  const sides = TEAMS.map((team) => {
    const players = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.team === team.id)
      .sort((a, b) => a.row.slot - b.row.slot)
    return {
      ...team,
      players,
      kills: players.reduce((total, { row }) => total + row.kills, 0),
      souls: players.reduce((total, { row }) => total + row.netWorth, 0),
    }
  })
  const [amber, sapphire] = sides
  const totalSouls = amber.souls + sapphire.souls
  const amberShare = totalSouls > 0 ? amber.souls / totalSouls : 0.5
  const lead = amber.souls - sapphire.souls

  const team = (side: (typeof sides)[number], align: 'end' | 'start') => (
    <div
      role="group"
      aria-label={side.name}
      className={`flex min-w-0 gap-0.5 overflow-x-auto ${align === 'end' ? 'lg:justify-end' : ''}`}
    >
      {side.players.map(({ row, index }) => (
        <Portrait
          key={row.slot}
          row={row}
          spot={spots[index]}
          colour={side.colour}
          selected={selected === index}
          onClick={() => onSelect(selected === index ? null : index)}
        />
      ))}
    </div>
  )

  return (
    <section
      aria-label="Match overview"
      className="grid grid-cols-1 items-center gap-x-6 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
    >
      {team(amber, 'end')}

      <div className="order-first flex flex-col items-center lg:order-none">
        <div className="flex items-baseline gap-4">
          <span
            className="w-8 text-right text-[1.25rem] leading-none font-semibold"
            style={{ color: amber.colour }}
            aria-label={`Amber Hand ${amber.kills} kills`}
          >
            {amber.kills}
          </span>
          <span className="text-ui-fg text-[1.375rem] leading-none font-semibold">{gameClock(timeline, at)}</span>
          <span
            className="w-8 text-[1.25rem] leading-none font-semibold"
            style={{ color: sapphire.colour }}
            aria-label={`Sapphire Flame ${sapphire.kills} kills`}
          >
            {sapphire.kills}
          </span>
        </div>

        {/* The soul lead: each side's share of all souls in the game, meeting where the
            lead puts it, with the margin on the leading side. */}
        <div className="mt-2 w-40" title="Soul lead">
          <div className="flex h-1 overflow-hidden rounded-full">
            <span style={{ width: `${amberShare * 100}%`, background: amber.colour }} />
            <span className="flex-1" style={{ background: sapphire.colour }} />
          </div>
          <p className="mt-1 flex justify-between text-[0.6875rem]">
            <span style={{ color: amber.colour }}>{lead > 0 ? `+${compact(lead)}` : ''}</span>
            <span className="text-ui-muted">souls</span>
            <span style={{ color: sapphire.colour }}>{lead < 0 ? `+${compact(-lead)}` : ''}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={onBoard}
          aria-pressed={boardOpen}
          title="Full scoreboard (S)"
          className={`ui-button mt-1 px-2 py-0.5 text-[0.6875rem] ${
            boardOpen ? 'text-ui-fg bg-ui-raised' : ''
          }`}
        >
          Scoreboard <kbd className="text-ui-faint font-sans">S</kbd>
        </button>
      </div>

      {team(sapphire, 'start')}
    </section>
  )
}
