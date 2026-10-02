import { MAP_RADIUS } from './manifest'
import { LEGACY_UNDERGROUND_MASK, UNDERGROUND_CELLS, UNDERGROUND_MASK } from './underground'

/**
 * Below the streets, the game's minimap tells two places apart and draws each with its
 * own background (panorama/styles/hud_minimap.css): `underground`, the rooms and
 * corridors under the middle of the map round the Mid-Boss's pit, and `tunnels`, the
 * sewer-like passages elsewhere. Neither is networked, so both are worked out from where
 * a hero stands:
 *
 *  - underground: on the underground layer's walkable shapes, and below `UNDERGROUND_Z`.
 *    The streets over that area are all at 224 or higher and the rooms below at about
 *    -160 to 64, with next to nothing between (one real match). The tunnel volumes do
 *    not cover it: the Mid-Boss's pit, at about -800, is below every one of them.
 *  - tunnels: anywhere else inside a tunnel volume (`Positions.tunnel`).
 *
 * The map before the 2026-10 update had both too, its own rooms under the middle round
 * the same pit (see scripts/gen-minimap-image.py for where its art comes from), and the
 * same cut-off holds there: four replays put its rooms at about -160 to 128 and the
 * streets over them at 160 and up. It has no tunnels art, though.
 */
export type Below = 'underground' | 'tunnels'

const decoded = new Map<string, Uint8Array>()

function mask(current: boolean): Uint8Array {
  const packed = current ? UNDERGROUND_MASK : LEGACY_UNDERGROUND_MASK
  let cells = decoded.get(packed)
  if (!cells) {
    const bytes = atob(packed)
    cells = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) cells[i] = bytes.charCodeAt(i)
    decoded.set(packed, cells)
  }
  return cells
}

/** Whether a world position is on the walkable part of the area under the middle, on
 * the current map or (`current` false) the one before the 2026-10 update. */
export function isUnderground(x: number, y: number, current = true): boolean {
  const col = Math.floor(((x + MAP_RADIUS) / (2 * MAP_RADIUS)) * UNDERGROUND_CELLS)
  const row = Math.floor(((MAP_RADIUS - y) / (2 * MAP_RADIUS)) * UNDERGROUND_CELLS)
  if (col < 0 || row < 0 || col >= UNDERGROUND_CELLS || row >= UNDERGROUND_CELLS) return false
  const bit = row * UNDERGROUND_CELLS + col
  return (mask(current)[bit >> 3] & (0x80 >> (bit & 7))) !== 0
}

/** World height under which a hero on the underground layer's footprint is below it. */
export const UNDERGROUND_Z = 150

/** Where below the streets a hero is, if anywhere: `inTunnel` is whether they are in a
 * tunnel volume, `current` whether the match is on the current map -- see ./version. */
export function belowAt(
  x: number,
  y: number,
  z: number,
  inTunnel: boolean,
  current = true,
): Below | null {
  if (z < UNDERGROUND_Z && isUnderground(x, y, current)) return 'underground'
  return inTunnel ? 'tunnels' : null
}
