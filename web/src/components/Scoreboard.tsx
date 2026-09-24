import { AMBER, SAPPHIRE, type Row } from '../demo/types'
import { compact } from '../stats/format'
import { rankLabel } from '../demo/rank'
import { HeroIcon } from './HeroIcon'

const TEAMS = [
  { id: AMBER, name: 'Amber Hand', text: 'text-data-amber' },
  { id: SAPPHIRE, name: 'Sapphire Flame', text: 'text-data-sapphire' },
]

const HEAD = 'column-head py-2 text-[0.6875rem] whitespace-nowrap'
const NUM = 'px-2 py-2 text-right tabular-nums'

/**
 * A team's souls, the figure a scoreboard is usually read for first.
 *
 * Sums net worth rather than tracking a team total from the replay: the per-player
 * numbers are what the rows show, so a total derived from anything else could disagree
 * with the column under it.
 */
function teamSouls(rows: Row[]): number {
  return rows.reduce((total, row) => total + row.netWorth, 0)
}

function teamKills(rows: Row[]): number {
  return rows.reduce((total, row) => total + row.kills, 0)
}

/** Which row is open in the inspector, and how to open or close one. */
type Selection = { selected: number | null; onSelect: (player: number | null) => void }

function PlayerRow({
  row,
  player,
  leadNet,
  selected,
  onSelect,
}: { row: Row; player: number; leadNet: number } & Selection) {
  /*
   * A bar behind the souls cell, scaled against the richest player on the board. It is
   * the one figure that separates players at a glance, and a bar reads faster than five
   * digits do -- but it stays behind the number rather than replacing it.
   */
  const share = leadNet > 0 ? (row.netWorth / leadNet) * 100 : 0

  /*
   * A dead player's row is stepped back rather than hidden: still readable, but the
   * living side of a fight reads first. Not lower than this, or the figures in it stop
   * being legible against the well.
   */
  const isSelected = selected === player
  const rank = rankLabel(row.rank)
  return (
    // The whole row opens the inspector; the button in the first cell is what a keyboard
    // reaches, and its click bubbles up to this one handler.
    <tr
      onClick={() => onSelect(isSelected ? null : player)}
      className={`border-ui-line hover:bg-ui-raised cursor-pointer border-b last:border-0 ${
        row.alive ? '' : 'opacity-65'
      } ${isSelected ? 'bg-ui-raised' : ''} transition-[opacity,background-color]`}
      // Selection is the application's: a raised row with a thin cream edge, not a glow.
      style={isSelected ? { boxShadow: 'inset 2px 0 0 var(--ui-accent)' } : undefined}
    >
      <td className="py-1.5 pr-2 pl-3">
        <button
          type="button"
          aria-pressed={isSelected}
          title={`${row.name} — click to inspect`}
          className="flex w-full items-center gap-2.5 text-left"
        >
          <HeroIcon heroId={row.heroId} />
          <div className="min-w-0">
            <div className="text-ui-fg truncate text-[0.8125rem] leading-tight font-medium">
              {row.name}
            </div>
            <div className="text-ui-muted text-[0.6875rem] leading-tight">
              {/* Said in words, because a dimmed row alone does not explain itself. */}
              Level {row.level}
              {rank && ` · ${rank}`}
              {!row.alive && ' · dead'}
            </div>
          </div>
        </button>
      </td>
      <td className={`${NUM} text-ui-fg text-[0.875rem] font-semibold whitespace-nowrap`}>
        {row.kills}
        <span className="text-ui-faint font-normal"> / </span>
        <span className="text-data-death">{row.deaths}</span>
        <span className="text-ui-faint font-normal"> / </span>
        <span className="text-ui-muted font-normal">{row.assists}</span>
      </td>
      <td className={`${NUM} relative`}>
        <span
          aria-hidden="true"
          className="bg-ui-raised absolute inset-y-1 left-0 rounded-[2px]"
          style={{ width: `${share}%` }}
        />
        <span className="text-ui-fg relative text-[0.8125rem]">{compact(row.netWorth)}</span>
      </td>
      <td className={`${NUM} text-ui-muted text-[0.8125rem]`}>{compact(row.heroDamage)}</td>
      <td className={`${NUM} text-ui-muted hidden text-[0.8125rem] @md:table-cell`}>
        {compact(row.objectiveDamage)}
      </td>
      <td className={`${NUM} text-ui-muted hidden text-[0.8125rem] @md:table-cell`}>
        {compact(row.healing)}
      </td>
      <td className={`${NUM} text-ui-muted hidden text-[0.8125rem] @lg:table-cell`}>
        {row.lastHits}
        <span className="text-ui-muted"> / {row.denies}</span>
      </td>
    </tr>
  )
}

function TeamTable({
  team,
  rows,
  players,
  leadNet,
  selected,
  onSelect,
}: {
  team: (typeof TEAMS)[number]
  rows: Row[]
  /** Each row's index into the match's players, by lobby slot. */
  players: Map<number, number>
  leadNet: number
} & Selection) {
  // The game's own order: each player's lobby slot is fixed for the match and assigns
  // their lane, so sorting by it gives the same row to the same player throughout --
  // unlike net worth, which would swap rows under a player mid-fight as the numbers
  // change, right when they are hardest to re-find.
  const ordered = [...rows].sort((a, b) => a.slot - b.slot)

  return (
    <section className="ui-panel @container overflow-hidden">
      <header className="section-band flex items-baseline justify-between px-3 py-2">
        <h3 className={`text-[0.875rem] leading-none font-semibold ${team.text}`}>
          {team.name}
        </h3>
        <p className="text-ui-muted flex gap-3 text-[0.75rem]">
          <span>
            <span className="text-ui-fg font-medium">{teamKills(rows)}</span> kills
          </span>
          <span>
            <span className="text-ui-fg font-medium">{compact(teamSouls(rows))}</span> souls
          </span>
        </p>
      </header>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th className={`${HEAD} pl-3`}>Player</th>
            <th className={`${HEAD} px-2 text-right whitespace-nowrap`}>K / D / A</th>
            <th className={`${HEAD} px-2 text-right`}>Souls</th>
            <th className={`${HEAD} px-2 text-right`}>Damage</th>
            <th className={`${HEAD} hidden px-2 text-right @md:table-cell`}>Obj</th>
            <th className={`${HEAD} hidden px-2 text-right @md:table-cell`}>Healing</th>
            <th className={`${HEAD} hidden px-2 text-right @lg:table-cell`}>LH / DN</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <PlayerRow
              key={row.slot}
              row={row}
              player={players.get(row.slot) ?? -1}
              leadNet={leadNet}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Both teams, side by side, as they stood at one moment in the match. */
export function Scoreboard({ rows, selected, onSelect }: { rows: Row[] } & Selection) {
  // One scale across both teams, or a bar would mean something different on each side.
  const leadNet = Math.max(...rows.map((row) => row.netWorth), 1)
  // `rows` is in the match's player order, so a row's place in it is its player index.
  const players = new Map(rows.map((row, index) => [row.slot, index]))

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {TEAMS.map((team) => (
        <TeamTable
          key={team.id}
          team={team}
          rows={rows.filter((row) => row.team === team.id)}
          players={players}
          leadNet={leadNet}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
