import type { DamageKind } from './types'

/** What to call each kind of thing that can deal or take damage, or land a kill. */
export const KIND_LABELS: Record<DamageKind, string> = {
  hero: 'Hero',
  trooper: 'Troopers',
  neutral: 'Neutrals',
  guardian: 'Guardian',
  walker: 'Walker',
  baseGuardian: 'Base Guardian',
  shrine: 'Shrine',
  patron: 'Patron',
  midBoss: 'Mid-Boss',
  other: 'Other',
}
