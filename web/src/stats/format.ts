/*
 * English on purpose, not the browser's locale: compact notation spells its suffix as a
 * word, and a browser set to another language turns 21,400 into something like "21,4 тыс."
 * beside English labels. The match history's averages already print with a dot, so this
 * matches them too.
 */
const compactFormat = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/*
 * Dates are English for the same reason, with a 24-hour clock: a date line reading
 * "18 вер." under English column headings is the mixed-language page this avoids.
 */
const timeFormat = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const dayYearFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
const fullFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'full',
  timeStyle: 'short',
  hourCycle: 'h23',
})

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * When a match was played, to the minute, in the viewer's time zone: "Today, 21:14",
 * "Yesterday, 09:02", "Sep 16, 21:14". A match from an earlier year drops the time for
 * the year, which by then says more.
 */
export function playedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  // Rounded, not floored: a day that crosses a daylight-saving change is 23 or 25 hours.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  const time = timeFormat.format(date)

  if (daysAgo === 0) return `Today, ${time}`
  if (daysAgo === 1) return `Yesterday, ${time}`
  if (date.getFullYear() !== now.getFullYear()) return dayYearFormat.format(date)
  return `${dayFormat.format(date)}, ${time}`
}

/** A day as a heading: "Today", "Yesterday", "Sep 16", or "Dec 30, 2025" from an earlier year. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (date.getFullYear() !== now.getFullYear()) return dayYearFormat.format(date)
  return dayFormat.format(date)
}

/** The local calendar day an instant falls on, as a key: "2026-09-16". */
export function dayKey(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Just the time, "21:14" -- for a row already under its day's heading. */
export function timeOfDay(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : timeFormat.format(date)
}

/** When a match ended, as an ISO instant: its start plus its length. */
export function endTime(startIso: string, seconds: number): string {
  return new Date(new Date(startIso).getTime() + seconds * 1000).toISOString()
}

/** "Friday, September 18, 2026 at 21:14", for a tooltip with room to spell it out. */
export function fullDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : fullFormat.format(date)
}

/** 0.547 → "55%". */
export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** 8.23 → "8.2", 21436 → "21.4K": per-game figures range from single digits to tens of thousands. */
export function compact(value: number | null): string {
  return value === null ? '—' : compactFormat.format(value)
}

/** 0.152 → "+15%", -0.08 → "−8%", with a real minus sign so the column lines up. */
export function signedPercent(fraction: number | null): string {
  if (fraction === null) return '—'
  const rounded = Math.round(fraction * 100)
  if (rounded === 0) return '0%'
  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`
}

/**
 * A gap between two rates, in percentage points: 11 → "+11 pts", -3 → "−3 pts". Points,
 * not percent: 60% against 49% is 11 points higher, which "+11%" would misstate.
 */
export function signedPoints(points: number | null): string {
  if (points === null) return '—'
  if (points === 0) return '±0 pts'
  return points > 0 ? `+${points} pts` : `−${Math.abs(points)} pts`
}

/**
 * Match length in whole minutes, "43 min" -- for beside a start time, where "43:17" would
 * read as another clock time.
 */
export function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`
}

/** Match length as m:ss, the way the in-game scoreboard shows it. */
export function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
