import { KILL_FEED_LINGER, lingerFor, type KillSpot } from '../demo/events'
import { KIND_LABELS } from '../demo/kinds'
import type { Player } from '../demo/types'
import { HeroFace } from './HeroIcon'

/**
 * Who killed whom, in the corner of the map, the way the game shows it: newest on top,
 * killer on the left, victim on the right, and gone after a few seconds.
 *
 * Faces rather than names, because that is what the map is drawn in -- the feed names a
 * portrait the eye can then find -- and a row of three faces is narrow enough not to
 * cover the base it sits over. Names are on hover.
 */

/** A face in the feed, in pixels. */
const FACE = 24
/** An assister's face: smaller, since they are the footnote to the kill. */
const ASSIST = 16

export function KillFeed({
  kills,
  players,
  speed,
}: {
  /** Newest first. */
  kills: KillSpot[]
  players: Player[]
  speed: number
}) {
  if (kills.length === 0) return null
  const linger = lingerFor(KILL_FEED_LINGER, speed)

  return (
    <ol aria-label="Kill feed" className="absolute top-2 right-2 flex flex-col items-end gap-1">
      {kills.map((kill) => {
        const victim = players[kill.victim]
        const killer = players[kill.killer]
        // A death the game credited to nobody, with a hero's own blow as its cause, is
        // a hero killing themselves.
        const by = killer?.name ?? (kill.cause === 'hero' ? 'Suicide' : KIND_LABELS[kill.cause])
        const assisters = kill.assisters
          .filter((a) => a !== kill.killer)
          .map((a) => players[a])
          .filter(Boolean)
        // Out over the last quarter of its time, so a row reads at full strength for
        // almost all of it and does not vanish mid-glance.
        const t = kill.age / linger
        const opacity = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) * 4)
        return (
          <li
            key={kill.id}
            className="bg-ui-surface/95 border-ui-line rounded-ui flex items-center gap-1.5 border px-1.5 py-1"
            style={{ opacity }}
          >
            {killer ? (
              <HeroFace player={killer} size={FACE} />
            ) : (
              <span className="text-ui-muted px-0.5 text-[0.6875rem]">{by}</span>
            )}
            {assisters.length > 0 && (
              <span
                className="flex -space-x-1"
                aria-label={`Assisted by ${assisters.map((a) => a.name).join(', ')}`}
              >
                {assisters.map((a) => (
                  <HeroFace key={a.slot} player={a} size={ASSIST} />
                ))}
              </span>
            )}
            {/* An arrow from killer to victim, the one mark every kill feed uses. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="text-ui-muted h-3.5 w-3.5 shrink-0"
            >
              <path
                d="M2 8h10M9 4.5L12.5 8 9 11.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {victim && <HeroFace player={victim} size={FACE} />}
            <span className="sr-only">
              {by} killed {victim?.name}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
