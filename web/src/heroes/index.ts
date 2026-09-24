import { HERO_SLUGS } from './manifest'

/**
 * Hero artwork, keyed by the GC's hero id.
 *
 * Both sets are mirrored into src/assets/heroes/ by scripts/gen-hero-images.mjs and
 * committed, so a fresh checkout has them without a network call. Vite hashes and emits
 * each file, which is why they are globbed rather than built into a URL string: a missing
 * file shows up as an absent entry here instead of a 404 in the browser.
 */
const icons = index(
  import.meta.glob('../assets/heroes/icons/*.webp', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
)

const portraits = index(
  import.meta.glob('../assets/heroes/portraits/*.webp', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
)

function index(modules: Record<string, string>): Record<string, string> {
  const bySlug: Record<string, string> = {}
  for (const [path, url] of Object.entries(modules)) {
    const file = path.split('/').pop()
    if (file) bySlug[file.replace('.webp', '')] = url
  }
  return bySlug
}

/**
 * Mirrors the slugify in scripts/gen-hero-images.mjs.
 *
 * Kept so a caller holding only a name can still find the artwork -- the hero stats rows
 * carry a name and no id. Both names come from the same deadlock-api hero list, so they
 * agree; this normalises anyway rather than trusting the spelling to round-trip.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function lookup(set: Record<string, string>, heroId?: number, heroName?: string | null) {
  // hero_id 0 is the account-wide totals row, not a hero.
  if (heroId) {
    const slug = HERO_SLUGS[heroId]
    if (slug && set[slug]) return set[slug]
  }
  if (heroName) return set[slugify(heroName)]
  return undefined
}

/** 128x128 square, for a table row. */
export function heroIcon(heroId?: number, heroName?: string | null) {
  return lookup(icons, heroId, heroName)
}

/** 280x380 portrait, for anywhere a hero is the subject rather than a label. */
export function heroPortrait(heroId?: number, heroName?: string | null) {
  return lookup(portraits, heroId, heroName)
}
