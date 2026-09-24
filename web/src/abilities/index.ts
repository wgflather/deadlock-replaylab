import { ABILITY_NAMES, ITEMS, SOURCES } from './manifest'

/**
 * Ability and item-active artwork and names, keyed by the class name a replay's cast
 * events carry. Mirrored into src/assets/abilities/ by scripts/gen-ability-images.mjs and
 * committed, the same arrangement as the hero artwork in ../heroes.
 *
 * The icons are white glyphs on transparency, the way the game draws them over its own
 * dark HUD slots, so whatever shows one has to give it a dark backing.
 */
const icons: Record<string, string> = {}
for (const [path, url] of Object.entries(
  import.meta.glob('../assets/abilities/*.webp', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
)) {
  const file = path.split('/').pop()
  if (file) icons[file.replace('.webp', '')] = url
}

export function abilityIcon(className: string): string | undefined {
  return icons[className]
}

/**
 * The name the game shows, or failing that a readable form of the class name:
 * `citadel_ability_sticky_bomb` becomes "Sticky Bomb". The fallback is only a stand-in
 * -- some class names are codenames that no reformatting turns into the real thing -- for
 * an ability newer than the last `npm run assets:abilities`.
 */
export function abilityName(className: string): string {
  const known = ABILITY_NAMES[className]
  if (known) return known
  return className
    .replace(/^(citadel_ability_|ability_|upgrade_)/, '')
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

/** What dealt a hit, as far as the interface is concerned. */
export type Source = {
  className: string
  kind: 'ability' | 'item' | 'weapon'
  name: string
  icon: string | undefined
}

/**
 * The ability, item or weapon behind deadlock-api id `id`, as a damage event names it,
 * or undefined for an id newer than the last `npm run assets:abilities`.
 */
export function sourceOf(id: number): Source | undefined {
  const known = SOURCES[id]
  if (!known) return undefined
  const [className, kind] = known
  return {
    className,
    kind,
    // A hero's gun is listed without a display name of its own; it is their weapon.
    name: ABILITY_NAMES[className] ?? (kind === 'weapon' ? 'Weapon' : abilityName(className)),
    icon: abilityIcon(className),
  }
}

/** A shop item, as the item build shows it. */
export type ItemInfo = {
  className: string
  name: string
  icon: string | undefined
  slot: 'weapon' | 'vitality' | 'spirit'
  /** 1 to 4, the shop's price bands. */
  tier: number
  cost: number
  /** Class names of the items this one is built from. */
  components: string[]
}

/** The item behind deadlock-api id `id`, or undefined for one this build does not know. */
export function itemOf(id: number): ItemInfo | undefined {
  const known = SOURCES[id]
  const shop = ITEMS[id]
  if (!known || !shop) return undefined
  const [className] = known
  return {
    className,
    name: abilityName(className),
    icon: abilityIcon(className),
    slot: shop.slot,
    tier: shop.tier,
    cost: shop.cost,
    components: shop.components ?? [],
  }
}
