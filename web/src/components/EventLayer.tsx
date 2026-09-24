import { abilityIcon, abilityName } from '../abilities'
import { CAST_LINGER, DEATH_LINGER, lingerFor, type CastSpot, type KillSpot } from '../demo/events'
import { AMBER, type Player, type Spot } from '../demo/types'
import { worldToMap } from '../map'

/**
 * Deaths and casts on the map: the two kinds of moment a replay's state alone does not
 * show. A death reads, from positions and health, only as a portrait going pale; a cast
 * does not read at all.
 *
 * Drawn over the portraits, since a mark under the portrait it belongs to is a mark
 * nobody can see. Who killed whom is not drawn here but told in the kill feed -- see
 * KillFeed -- where it can be read without hunting the map for two faces.
 *
 * Everything fades by age against a linger measured in screen time -- see ../demo/events
 * -- so an event is on screen for the same moment at any playback speed.
 */

/** Matches MapView's portrait size, which the cast ring and icon sit around. */
const MARKER = 30
/** A cast icon's size in pixels: small enough to tuck under a portrait, large enough
 * for the glyph to be told from its neighbours. */
const CAST_ICON = 18
/** The death mark's size in pixels -- smaller than a portrait, so the pale portrait of
 * the fallen hero still shows round it. */
const DEATH_MARK = 16

function teamColour(team: number) {
  return team === AMBER ? 'var(--data-team-amber)' : 'var(--data-team-sapphire)'
}

/** 1 when fresh, falling to 0 as `age` reaches `linger`. Held at full for the first
 * half so a quick glance still catches it at full strength. */
function fade(age: number, linger: number) {
  const t = age / linger
  return t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2)
}

/** Death marks and cast icons, drawn over the portraits. */
export function EventMarks({
  kills,
  casts,
  spots,
  players,
  speed,
  zoom,
}: {
  kills: KillSpot[]
  casts: CastSpot[]
  /** Everyone's position now, which a cast icon follows. */
  spots: Spot[]
  players: Player[]
  speed: number
  zoom: number
}) {
  const deathLinger = lingerFor(DEATH_LINGER, speed)
  const castLinger = lingerFor(CAST_LINGER, speed)

  return (
    <>
      {kills.map((kill) => {
        if (kill.age > deathLinger) return null
        const { left, top } = worldToMap(kill.x, kill.y)
        return (
          <div
            key={`kill-${kill.id}`}
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: `${left * 100}%`,
              top: `${top * 100}%`,
              width: DEATH_MARK,
              height: DEATH_MARK,
              // Counter-scaled as a whole, never resized: see the note on the portrait
              // markers in MapView.
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
              opacity: fade(kill.age, deathLinger),
            }}
          >
            <svg viewBox="0 0 16 16" className="h-full w-full">
              {/* A dark underlay first, so the cross stays legible on either team's
                  colour and on the pale map alike. */}
              <path
                d="M3 3L13 13M13 3L3 13"
                strokeWidth={5}
                strokeLinecap="round"
                style={{ stroke: 'var(--data-marker-shadow)' }}
              />
              <path
                d="M3 3L13 13M13 3L3 13"
                strokeWidth={2.5}
                strokeLinecap="round"
                style={{ stroke: teamColour(players[kill.victim]?.team ?? 0) }}
              />
            </svg>
          </div>
        )
      })}

      {casts.map((cast) => {
        const spot = spots[cast.player]
        if (!spot || cast.age > castLinger) return null
        const { left, top } = worldToMap(spot.x, spot.y)
        const colour = teamColour(players[cast.player]?.team ?? 0)
        const icon = abilityIcon(cast.ability)
        const name = abilityName(cast.ability)
        // The ring grows out from the portrait over the first part of the linger: the
        // moment of the cast, as distinct from the icon that says what it was.
        const burst = Math.min(cast.age / (castLinger * 0.4), 1)
        return (
          <div
            key={`cast-${cast.id}`}
            className="pointer-events-none absolute"
            style={{
              left: `${left * 100}%`,
              top: `${top * 100}%`,
              width: 0,
              height: 0,
              transform: `scale(${1 / zoom})`,
              opacity: fade(cast.age, castLinger),
            }}
          >
            {!cast.item && burst < 1 && (
              <span
                aria-hidden="true"
                className="absolute rounded-full border-2"
                style={{
                  width: MARKER,
                  height: MARKER,
                  left: -MARKER / 2,
                  top: -MARKER / 2,
                  borderColor: colour,
                  transform: `scale(${1 + burst * 0.8})`,
                  opacity: 1 - burst,
                }}
              />
            )}
            {/*
              Tucked under the portrait's lower edge. The glyphs are white on
              transparency, so they sit on the well colour with the caster's team as the
              rim -- round for an ability, square for an item, the way the game's own HUD
              tells its two kinds of slot apart.
            */}
            <span
              role="img"
              aria-label={name}
              className={`bg-ui-inset absolute flex items-center justify-center border-[1.5px] ${
                cast.item ? 'rounded-[3px]' : 'rounded-full'
              }`}
              style={{
                width: CAST_ICON,
                height: CAST_ICON,
                left: -CAST_ICON / 2,
                top: MARKER / 2 - CAST_ICON / 3,
                borderColor: colour,
              }}
            >
              {icon ? (
                <img src={icon} alt="" draggable={false} className="h-[78%] w-[78%]" />
              ) : (
                // No icon for this one: its initial, rather than nothing at all.
                <span className="text-ui-fg text-[0.5625rem] leading-none font-bold">
                  {name[0]}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </>
  )
}
