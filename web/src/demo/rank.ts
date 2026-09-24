/*
 * The game's ranked tiers, lowest first; a badge's tier is its tens digit. Tier 0 is
 * the unranked "Obscurus" and never comes with a subtier.
 */
const TIERS = [
  'Obscurus',
  'Initiate',
  'Seeker',
  'Alchemist',
  'Arcanist',
  'Ritualist',
  'Emissary',
  'Archon',
  'Oracle',
  'Phantom',
  'Ascendant',
  'Eternus',
]

/**
 * A packed ranked badge (tier * 10 + subtier 1-6) as the name players know it, such as
 * "Eternus 6", or null when the player has no rank to show.
 */
export function rankLabel(badge: number): string | null {
  const tier = Math.floor(badge / 10)
  const subtier = badge % 10
  if (tier < 1 || tier >= TIERS.length || subtier < 1 || subtier > 6) return null
  return `${TIERS[tier]} ${subtier}`
}
