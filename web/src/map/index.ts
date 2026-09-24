import minimapUrl from '../assets/map/minimap.webp'
import { MAP_RADIUS } from './manifest'

export { MAP_RADIUS }

/**
 * The map's ground: streets and blocks, and nothing else.
 *
 * The game draws its minimap from separate layers -- the geometry, the circular frame
 * around it, a backing, and the four lane paths -- so there is no circle to cut away.
 * This is the geometry layer alone, which is why the map sits on the page's own surface
 * rather than inside borrowed chrome.
 *
 * It is repainted rather than used as shipped. In the source the layer is near-black in
 * every channel and the map is carried entirely by its alpha: dropped straight onto a
 * dark interface it would be invisible. So the alpha is read as a height -- roughly 110
 * for a block and 205 for a street -- and painted between two tones. That also makes it
 * a third of the size, since the original's colour channels were noise.
 *
 * The tones are the game's own, sampled from its minimap artwork: neutral greys with a
 * faint green lift, blocks lighter than the streets between them. They are lifted well
 * above the artwork's own values, though, because there the whole city sits on a pale
 * disc that carries the contrast. With the disc gone there is nothing behind the map but
 * the page, and at the artwork's real values -- #222622 on #0d0f0d -- it disappears into
 * it.
 *
 * The outer silhouette is feathered a few pixels into the page rather than cut clean:
 * without the disc, a hard edge read as a sticker dropped onto the surface behind it
 * instead of ground meeting it. Only that outer boundary is soft -- the lines between a
 * block and the street beside it are untouched, so the map still reads at a glance.
 *
 * To redo it from a newer version of the layer: take the alpha channel as the shape, ramp
 * it from #5a615a at 110 to #202420 at 205, drop everything under 40, blur a copy of the
 * 0/255 "is this the city at all" mask by 4px and multiply the ramped alpha by it, then
 * pad by MAP_IMAGE_MARGIN.
 */
export const MINIMAP = minimapUrl

/**
 * How far past the playable radius the image reaches.
 *
 * The layer spans exactly the playable radius, but spawn rooms sit a little outside it --
 * positions up to about 1.02x show up in a real match -- so it is padded with
 * transparency rather than clipping players at the moment they leave the fight.
 */
export const MAP_IMAGE_MARGIN = 1080 / 1024

/** World units from the centre to the edge of the image, on both axes. */
export const MAP_IMAGE_RADIUS = MAP_RADIUS * MAP_IMAGE_MARGIN

/**
 * A world position as a fraction of the map image, `{0,0}` top-left to `{1,1}`
 * bottom-right.
 *
 * North is up on the picture and +y is north in the world, so y is flipped on the way
 * through; x is not.
 *
 * Positions are not clamped. A player can legitimately be outside the padded area, and
 * pinning them to it would misreport where they are.
 */
export function worldToMap(x: number, y: number): { left: number; top: number } {
  const span = MAP_IMAGE_RADIUS * 2
  return {
    left: (x + MAP_IMAGE_RADIUS) / span,
    top: (MAP_IMAGE_RADIUS - y) / span,
  }
}
