import { AMBER, type Player } from '../demo/types'
import { heroIcon, heroPortrait } from '../heroes'

function initials(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

/**
 * The hero's face at row scale.
 *
 * `alt` is empty on purpose: every use sits beside the hero's name, so a screen reader
 * announcing it again would only repeat the label. A hero with no artwork -- one the
 * bucket is missing, or newer than the last mirror -- falls back to initials rather than
 * a broken image or a gap that shifts the column.
 */
export function HeroIcon({
  heroId,
  heroName,
}: {
  heroId?: number
  heroName?: string | null
}) {
  const url = heroIcon(heroId, heroName)
  const label = heroName ?? (heroId ? `Hero ${heroId}` : '')

  if (!url) {
    return (
      <span
        aria-hidden="true"
        className="frame text-ui-muted rounded-ui inline-flex h-7 w-7 shrink-0 items-center justify-center text-[0.5625rem] font-medium"
      >
        {initials(label)}
      </span>
    )
  }

  return (
    <img
      src={url}
      alt=""
      width={28}
      height={28}
      loading="lazy"
      decoding="async"
      // The same brass mount as the avatar, scaled down: a hairline and a one-pixel gap
      // around the 24px face.
      className="frame rounded-ui h-7 w-7 shrink-0 object-cover p-px"
    />
  )
}

/**
 * The full-resolution portrait, 280x380, in a plain frame.
 *
 * Sized by its container rather than fixed here, so the same file serves a small panel
 * and a large one.
 */
export function HeroPortrait({
  heroId,
  heroName,
  className = '',
}: {
  heroId?: number
  heroName?: string | null
  className?: string
}) {
  const url = heroPortrait(heroId, heroName)
  if (!url) return null

  return (
    <img
      src={url}
      alt={heroName ?? ''}
      width={280}
      height={380}
      loading="lazy"
      decoding="async"
      className={`frame rounded-ui object-cover object-top ${className}`}
    />
  )
}

/**
 * A hero's face in a round frame of their team's colour, at `size` pixels -- how the
 * map, the kill feed and the inspector all show a player. Their name is on hover.
 */
export function HeroFace({ player, size }: { player: Player; size: number }) {
  const icon = heroIcon(player.heroId)
  return (
    <span
      title={player.name}
      className="bg-ui-bg block shrink-0 overflow-hidden rounded-full border-2"
      style={{
        width: size,
        height: size,
        borderColor: player.team === AMBER ? 'var(--data-team-amber)' : 'var(--data-team-sapphire)',
      }}
    >
      {icon && (
        <img src={icon} alt={player.name} draggable={false} className="h-full w-full object-cover" />
      )}
    </span>
  )
}
