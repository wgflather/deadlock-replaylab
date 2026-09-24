import { useId } from 'react'
import { SAPPHIRE, type ObjectiveKind } from '../demo/types'
import type { IconColours } from '../map/palette'
import midBossUrl from '../assets/map/midboss.png'

/**
 * A structure's minimap icon, doubling as its health bar.
 *
 * The shapes are the game minimap's own, lifted path for path from the vector smart
 * objects in the minimap source (COMPS/Lanes.psb) rather than redrawn: a dark outline, a
 * fill and, on a Walker or Shrine, a dark core. Health is the fill itself -- it drains
 * from the top as the structure loses health, leaving the core's dark shade behind, so
 * there is no separate bar to read. Which colours those are depends on whose eyes the
 * map is seen through; see ../map/palette.
 *
 * Coordinates below are the source PDF's own units, top-left origin.
 */
type Shape = {
  /** x, y, width, height: the outline's extent, which is what gets drawn. */
  box: [number, number, number, number]
  outline: string[]
  fill: string[]
  core?: string
  /** The fill's own vertical extent, so the drained level tracks the coloured part
   * rather than the outline around it. */
  fillSpan: [number, number]
  /** The point that sits on the structure's world position: the diamond's centre. */
  anchor: [number, number]
}

const DIAMOND_OUTLINE = 'M25.4 3.14L47.66 25.4L25.4 47.66L3.14 25.4Z'
const DIAMOND_FILL = 'M25.4 5.4L45.4 25.4L25.4 45.4L5.4 25.4Z'
const DIAMOND_CORE = 'M25.4 16.35L34.45 25.4L25.4 34.45L16.35 25.4Z'

const DIAMOND: Shape = {
  box: [3.14, 3.14, 44.52, 44.52],
  outline: [DIAMOND_OUTLINE],
  fill: [DIAMOND_FILL],
  fillSpan: [5.4, 45.4],
  anchor: [25.4, 25.4],
}

const CORED_DIAMOND: Shape = { ...DIAMOND, core: DIAMOND_CORE }

/** A half-ring arch behind a diamond. Drawn arch-down, as for the team at the bottom of
 * the map; the team at the top gets it flipped, so the arch always faces away from the
 * centre. */
const PATRON: Shape = {
  box: [3.19, 3.12, 119.14, 83.49],
  outline: [
    'M3.19 25.54L37.92 25.54L37.92 27.04C37.92 40.74 49.06 51.89 62.77 51.89C76.46 51.89 87.61 40.74 87.61 27.04L87.61 25.54L122.33 25.54L122.33 27.04C122.33 59.89 95.61 86.61 62.77 86.61C29.92 86.61 3.19 59.89 3.19 27.04Z',
    'M62.76 3.12L85.03 25.38L62.76 47.65L40.5 25.38Z',
  ],
  fill: [
    'M4.69 27.04L36.42 27.04C36.42 41.57 48.24 53.39 62.77 53.39C77.29 53.39 89.11 41.57 89.11 27.04L120.83 27.04C120.83 59.06 94.78 85.11 62.77 85.11C30.75 85.11 4.69 59.06 4.69 27.04Z',
    'M62.76 5.38L82.76 25.38L62.76 45.38L42.76 25.38Z',
  ],
  fillSpan: [5.38, 85.11],
  anchor: [62.76, 25.38],
}

const SHAPES: Record<ObjectiveKind, Shape> = {
  guardian: DIAMOND,
  baseGuardian: DIAMOND,
  walker: CORED_DIAMOND,
  shrine: CORED_DIAMOND,
  patron: PATRON,
  // Drawn from a picture instead -- see MID_BOSS_PX -- so this shape is never used.
  midBoss: DIAMOND,
}

/**
 * Screen pixels per source unit, per kind. The source places each icon at its own scale
 * -- a Walker at about 1.2 times a Guardian -- and those ratios are kept; only the
 * overall size is ours, set so a Guardian is 20px across.
 */
const GUARDIAN_PX = 20
const UNIT = GUARDIAN_PX / DIAMOND.box[2]
const SCALE: Record<ObjectiveKind, number> = {
  guardian: UNIT,
  baseGuardian: UNIT,
  shrine: UNIT,
  walker: UNIT * (45 / 37),
  patron: UNIT * (92 / 125.52 / (37 / 50.88)),
  midBoss: UNIT * (45 / 37),
}

/**
 * The Mid-Boss's icon is the minimap source's own picture (Minimap/midboss.png, glow
 * and all) rather than a shape: 91 source pixels square, on the same canvas and at the
 * same scale as Lanes.psb, where a Guardian's icon is 37 pixels across.
 */
const MID_BOSS_PX = 91 * (GUARDIAN_PX / (DIAMOND.box[2] * (37 / 50.88)))

/** The outline colour the source uses on every icon. */
const OUTLINE = '#232323'

/**
 * The icon, placed on the map: `left`/`top` are the structure's position as fractions
 * of the map layer, and `zoom` is that layer's scale, which the icon cancels so it stays
 * one size on screen -- the same counter-scale every other marker uses.
 */
export function ObjectiveIcon({
  kind,
  team,
  colours,
  hpFraction,
  destroyed,
  recentlyDamaged,
  left,
  top: mapTop,
  zoom,
}: {
  kind: ObjectiveKind
  /** Only for which way a Patron faces; its colours come from `colours`. */
  team: number
  colours: IconColours
  hpFraction: number
  destroyed: boolean
  /** Only read for the Mid-Boss, which shows a health bar while this holds. */
  recentlyDamaged: boolean
  left: number
  top: number
  zoom: number
}) {
  // useId's output carries characters url(#...) does not take unescaped.
  const clip = `objective-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  if (kind === 'midBoss') {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: `${left * 100}%`,
          top: `${mapTop * 100}%`,
          width: MID_BOSS_PX,
          height: MID_BOSS_PX,
          transform: `translate(-50%, -50%) scale(${1 / zoom})`,
          // Between lives there is nothing there to fight: faded, as a destroyed
          // structure is, until the next one spawns.
          opacity: destroyed ? 0.35 : 1,
        }}
      >
        <img src={midBossUrl} alt="" draggable={false} className="h-full w-full select-none" />
        {/* Only while it is being fought, and a few seconds after: a full-health bar
            on a monster nobody is attacking is noise on the one spot every lane
            passes near. Same bar as a player's, set just over the figure, inside the
            glow's margin. */}
        {recentlyDamaged && !destroyed && (
          <div className="bg-ui-inset/80 absolute top-[8%] left-1/2 h-[3px] w-[55%] -translate-x-1/2 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(Math.max(hpFraction, 0), 1) * 100}%`,
                background: `color-mix(in srgb, var(--data-health) ${Math.round(hpFraction * 100)}%, var(--data-damage))`,
              }}
            />
          </div>
        )}
      </div>
    )
  }

  const shape = SHAPES[kind]
  const [x, y, w, h] = shape.box
  const flipped = kind === 'patron' && team === SAPPHIRE
  // Mirrors y within the box, so a flipped shape still fills the same viewBox.
  const flip = flipped ? `matrix(1 0 0 -1 0 ${2 * y + h})` : undefined
  // The anchor as a fraction of the box, after any flip.
  const anchorX = (shape.anchor[0] - x) / w
  const anchorY = flipped ? 1 - (shape.anchor[1] - y) / h : (shape.anchor[1] - y) / h

  // The fill's extent on screen, after any flip, and the level it drains to.
  const [top, bottom] = flipped
    ? [2 * y + h - shape.fillSpan[1], 2 * y + h - shape.fillSpan[0]]
    : shape.fillSpan
  const level = Math.min(Math.max(hpFraction, 0), 1)
  const cut = bottom - (bottom - top) * level

  const { fill: colour, core: dark } = colours

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: `${left * 100}%`,
        top: `${mapTop * 100}%`,
        width: w * SCALE[kind],
        height: h * SCALE[kind],
        // Anchored on the icon's own diamond rather than its box: for the Patron, the
        // arch hangs off to one side of the point it stands on. Scaling about that same
        // point keeps it there at any zoom.
        transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`,
        transform: `translate(${-anchorX * 100}%, ${-anchorY * 100}%) scale(${1 / zoom})`,
        // Destroyed reads as gone, not dead: a player's marker dims and comes back next
        // life, but a fallen structure never returns, so its already empty icon fades
        // toward the map itself. The Mid-Boss does return, as a fresh life on the same
        // spot; between lives it reads the same way, which is fair: there is nothing
        // there to fight.
        opacity: destroyed ? 0.35 : 1,
      }}
    >
      <svg viewBox={`${x} ${y} ${w} ${h}`} className="block h-full w-full overflow-visible">
        <defs>
          <clipPath id={clip}>
            <rect x={x} y={cut} width={w} height={bottom - cut} />
          </clipPath>
        </defs>
        <g transform={flip}>
          {shape.outline.map((d) => (
            <path key={d} d={d} style={{ fill: OUTLINE }} />
          ))}
          {shape.fill.map((d) => (
            <path key={d} d={d} style={{ fill: dark }} />
          ))}
        </g>
        {/* The clip sits outside the flip so the level always drains top-down on screen. */}
        <g clipPath={`url(#${clip})`}>
          <g transform={flip}>
            {shape.fill.map((d) => (
              <path key={d} d={d} style={{ fill: colour }} />
            ))}
          </g>
        </g>
        {shape.core && (
          <path d={shape.core} transform={flip} style={{ fill: dark }} />
        )}
      </svg>
    </div>
  )
}
