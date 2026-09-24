/**
 * Minimap colours, by whose eyes the map is seen through.
 *
 * `'neutral'` is the replay's own view: each side in its team colour, Amber yellow and
 * Sapphire blue, lanes and structures alike. Viewing as a team is the game minimap's
 * view, with every colour taken from its source (COMPS/Lanes.psb): your structures in
 * the colour of the lane they stand on, your Shrines and Patron white, and everything
 * of the enemy's -- structures and lanes -- red.
 */
import { AMBER, SAPPHIRE, type ObjectiveKind } from '../demo/types'

export type ViewAs = 'neutral' | typeof AMBER | typeof SAPPHIRE

/** An icon's two colours: its fill, and the dark shade for a drained fill and a core. */
export type IconColours = { fill: string; core: string }

/** Your own structures on each lane, by lane id. */
const LANE_ICON: Record<number, IconColours> = {
  1: { fill: '#ffdf41', core: '#4d420d' }, // York
  4: { fill: '#2fc8e6', core: '#073a45' }, // Broadway
  6: { fill: '#6cb348', core: '#1b330f' }, // Greenwich
}
/** Your own Shrines and Patron, which belong to no lane. */
const BASE_ICON: IconColours = { fill: '#ffefd7', core: '#4d4840' }
/** Every enemy structure. */
const ENEMY_ICON: IconColours = { fill: '#dc4d30', core: '#411107' }

/** Your own zipline on each lane. Darker than the structures on it, as in the source. */
const LANE_LINE: Record<number, string> = {
  1: '#b9a44c', // York
  4: '#559bbe', // Broadway
  6: '#66985c', // Greenwich
}
/** Every enemy zipline. */
const ENEMY_LINE = '#8b3726'

function teamColour(team: number) {
  if (team === AMBER) return 'var(--data-team-amber)'
  if (team === SAPPHIRE) return 'var(--data-team-sapphire)'
  return 'var(--data-neutral)'
}

/** The source's cores are its fills at about 30% brightness; the same, for colours it
 * does not define. */
function shaded(fill: string): IconColours {
  return { fill, core: `color-mix(in srgb, ${fill} 30%, black)` }
}

export function objectiveColours(
  objective: { kind: ObjectiveKind; team: number; lane: number | null },
  view: ViewAs,
): IconColours {
  const { kind, team, lane } = objective
  // Neither side's -- the Mid-Boss -- whatever the view.
  if (view === 'neutral' || (team !== AMBER && team !== SAPPHIRE)) {
    return shaded(teamColour(team))
  }
  if (team !== view) return ENEMY_ICON
  if (kind === 'shrine' || kind === 'patron') return BASE_ICON
  return (lane !== null && LANE_ICON[lane]) || BASE_ICON
}

/** The colour of a stretch of lane `lane` that `owner` can ride. */
export function laneColour(lane: number, owner: number, view: ViewAs): string {
  if (view === 'neutral') return teamColour(owner)
  if (owner !== view) return ENEMY_LINE
  return LANE_LINE[lane] ?? teamColour(owner)
}
