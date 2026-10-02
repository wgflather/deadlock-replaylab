import { incomeAt, SOURCE_COLOURS, SOURCE_LABELS } from '../demo/income'
import type { Timeline } from '../demo/types'
import { gameClock } from '../demo/usePlayback'
import { compact } from '../stats/format'

/**
 * Where one player's souls came from, as of the playhead -- and, stated up front, how far
 * that split can be trusted. The replay records how many souls a player had, not where
 * each came from, so this is an estimate checked against the game's own figures every
 * few minutes. The split over the whole match is the Performance tab's "Souls from".
 */

export function SoulsTab({
  timeline,
  player,
  at,
}: {
  timeline: Timeline
  player: number
  at: number
}) {
  const { income, frames, sampleSeconds } = timeline
  const frame = Math.max(0, Math.min(frames - 1, Math.floor(at / sampleSeconds)))
  const shares = incomeAt(timeline, player, frame)
  const total = shares.reduce((sum, s) => sum + s.total, 0)
  const recent = shares.reduce((sum, s) => sum + s.recent, 0)
  // The last point the split was the game's own, if one has passed yet.
  const checked = income.checkpoints.filter((seconds) => seconds <= at).pop()

  if (!income.souls[player]) {
    return (
      <p className="text-ui-muted px-3 py-3 text-[0.75rem]">
        No soul income recorded for this player.
      </p>
    )
  }

  return (
    <div className="space-y-3 px-3 py-3">
      <p className="flex items-baseline gap-2">
        <span className="text-ui-muted text-[0.8125rem]">Earned</span>
        <span className="text-ui-fg text-[1.125rem] leading-none font-semibold">
          {compact(total)}
        </span>
        <span className="text-ui-muted text-[0.75rem]">+{compact(recent)} in the last minute</span>
      </p>

      <Caveat
        calibrated={income.calibrated}
        checked={checked === undefined ? null : gameClock(timeline, checked)}
      />

      <table className="w-full text-[0.75rem]">
        <thead>
          <tr className="text-ui-muted text-left">
            <th className="fact-label pb-1 font-normal">Source</th>
            <th className="fact-label pb-1 text-right font-normal">So far</th>
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr key={share.source}>
              <td className="relative py-0.5 pr-2">
                {/* The share of everything earned, as a bar behind the name. */}
                <span
                  aria-hidden="true"
                  className="bg-ui-raised absolute inset-y-0 left-0 rounded-[3px]"
                  style={{ width: `${total > 0 ? (share.total / total) * 100 : 0}%` }}
                />
                <span className="relative flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ background: SOURCE_COLOURS[share.source] }}
                  />
                  <span className="text-ui-fg">{SOURCE_LABELS[share.source]}</span>
                  <span className="text-ui-muted tabular-nums">
                    {total > 0 ? Math.round((share.total / total) * 100) : 0}%
                  </span>
                </span>
              </td>
              <td className="text-ui-fg py-0.5 text-right tabular-nums">{compact(share.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** How far the split can be trusted, said before the numbers are read. */
function Caveat({ calibrated, checked }: { calibrated: boolean; checked: string | null }) {
  return (
    <div className="border-ui-line-strong rounded-ui border px-2.5 py-2 text-[0.75rem]">
      {calibrated ? (
        <p className="text-ui-fg">
          An estimate, not the game's record. It matches the game's own split every 3-5 minutes
          {checked ? ` (last at ${checked})` : ''}; in between, about 1 soul in 9 lands under the
          wrong source.
        </p>
      ) : (
        <p className="text-ui-fg">
          A rough estimate. This replay stops before the end-of-match summary, so nothing here is
          checked against the game's own figures.
        </p>
      )}
      <details className="text-ui-muted mt-1">
        <summary className="hover:text-ui-fg cursor-pointer">Why it isn't exact</summary>
        <div className="mt-1 space-y-1.5">
          <p>
            A replay records how many souls each player has, moment to moment, but not where each
            one came from. The game sends that detail only to the player's own screen.
          </p>
          <p>
            What a replay does have, if it was recorded to the end, is the game's own split every 3
            minutes up to 15:00 and every 5 minutes after. Between those points, each gain is
            matched to what was happening at the time: a kill or assist, lane troopers dying close
            by, hitting a neutral camp, a crate or statue breaking. Then it is scaled to agree with
            the next point.
          </p>
          <p>
            Tested by hiding one of the game's points and estimating it, about 11-12% of souls were
            put under the wrong source. Neutral camps are the least reliable: most neutral creeps'
            deaths are not in a replay at all. Souls from items and abilities (such as Trophy
            Collector or Golden Goose Egg) and from the Urn have nothing to time them by, so they
            count as Other and are spread evenly.
          </p>
          <p>
            Team bonus is the game's own figure, but the game does not say what it is paid for, and
            it does not follow objectives: it starts before any has fallen. With nothing to time it
            by, it is spread evenly too.
          </p>
          <p>Earned includes souls later lost on death, so it runs a little above net worth.</p>
        </div>
      </details>
    </div>
  )
}
