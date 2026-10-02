/**
 * Which map a match was played on. The map was rebuilt in the 2026-10 update: new
 * streets, and ground below them -- the area under the middle and the tunnels -- with
 * minimap art of its own. The old map had tunnels too, but no art for them.
 */

/** The first game build on the current map (the replay header's build number). */
export const CURRENT_MAP_BUILD = 10932

/** Whether `build` is on the current map. 0 means the replay did not say: taken to be
 * current. */
export function isCurrentMap(build: number): boolean {
  return build === 0 || build >= CURRENT_MAP_BUILD
}
