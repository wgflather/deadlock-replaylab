import type { LaneSpot } from '../demo/types'
import { worldToMap } from '../map'
import { laneColour, type ViewAs } from '../map/palette'

/**
 * The lanes, drawn the way the game minimap draws them: each lane's zipline, coloured
 * along the stretches a side can currently ride.
 *
 * Styling is the minimap source's own (COMPS/Lanes.psb): straight segments between
 * rope nodes, butt caps, mitred corners, one flat colour -- which one depends on whose
 * eyes the map is seen through; see ../map/palette. A stretch nobody can ride is not
 * drawn at all.
 */

/**
 * Stroke width in screen pixels. The source's is 8px beside a 32px Guardian icon; the
 * map draws that icon at 20px, so the same ratio gives 5.
 */
const STROKE_PX = 5

/** The viewBox is the map layer in thousandths, so a point is `worldToMap` times this. */
const VIEW = 1000

/** Consecutive nodes with the same owner, as runs of node indices, each at least two
 * long -- a single node has no segment to draw. A segment whose two ends disagree
 * belongs to neither side, so a run ends at the last node it owns. */
function runs(owners: number[]) {
  const out: { team: number; from: number; to: number }[] = []
  let from = 0
  for (let i = 1; i <= owners.length; i++) {
    if (i < owners.length && owners[i] === owners[from]) continue
    if (owners[from] !== 0 && i - 1 > from) out.push({ team: owners[from], from, to: i - 1 })
    from = i
  }
  return out
}

export function ZiplineLayer({
  lanes,
  viewAs,
  zoom,
  framePx,
}: {
  lanes: LaneSpot[]
  viewAs: ViewAs
  zoom: number
  /** The map frame's width in CSS pixels, for holding the stroke at `STROKE_PX` on
   * screen: the layer is scaled by `zoom` and the viewBox again by the frame. */
  framePx: number
}) {
  if (framePx <= 0) return null
  const width = (STROKE_PX * VIEW) / (framePx * zoom)

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {lanes.flatMap((lane) =>
        runs(lane.owners).map((run) => {
          const points = []
          for (let i = run.from; i <= run.to; i++) {
            const { left, top } = worldToMap(lane.x[i], lane.y[i])
            points.push(`${left * VIEW},${top * VIEW}`)
          }
          return (
            <polyline
              key={`${lane.lane}-${run.from}`}
              points={points.join(' ')}
              fill="none"
              stroke={laneColour(lane.lane, run.team, viewAs)}
              strokeWidth={width}
              strokeLinecap="butt"
              strokeLinejoin="miter"
            />
          )
        }),
      )}
    </svg>
  )
}
