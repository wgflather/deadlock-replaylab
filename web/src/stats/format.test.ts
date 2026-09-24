import { describe, expect, it } from 'vitest'
import { dayKey, dayLabel, endTime, fullDateTime, minutes, playedAt, signedPoints, timeOfDay } from './format'

describe('signedPoints', () => {
  it('signs the gap, with a real minus', () => {
    expect(signedPoints(11)).toBe('+11 pts')
    expect(signedPoints(-3)).toBe('−3 pts')
    expect(signedPoints(0)).toBe('±0 pts')
    expect(signedPoints(null)).toBe('—')
  })
})

// Built from local components, so the expectations hold in any time zone.
const now = new Date(2026, 8, 18, 22, 30)
const at = (month: number, day: number, hour: number, minute: number, year = 2026) =>
  new Date(year, month, day, hour, minute).toISOString()

describe('playedAt', () => {
  it('names today and yesterday, with the time to the minute', () => {
    expect(playedAt(at(8, 18, 21, 14), now)).toBe('Today, 21:14')
    expect(playedAt(at(8, 17, 9, 2), now)).toBe('Yesterday, 09:02')
  })

  it('uses the date past yesterday, in English whatever the browser locale', () => {
    expect(playedAt(at(8, 16, 0, 5), now)).toBe('Sep 16, 00:05')
  })

  it('trades the time for the year when the match is from an earlier one', () => {
    expect(playedAt(at(11, 30, 20, 0, 2025), now)).toBe('Dec 30, 2025')
  })

  it('does not print "Invalid Date"', () => {
    expect(playedAt('not a date', now)).toBe('—')
    expect(fullDateTime('not a date')).toBe('')
  })
})

describe('fullDateTime', () => {
  it('spells the date out on a 24-hour clock', () => {
    expect(fullDateTime(at(8, 18, 21, 14))).toBe('Friday, September 18, 2026 at 21:14')
  })
})

describe('dayLabel', () => {
  it('names today and yesterday, then the date', () => {
    expect(dayLabel(at(8, 18, 21, 14), now)).toBe('Today')
    expect(dayLabel(at(8, 17, 9, 2), now)).toBe('Yesterday')
    expect(dayLabel(at(8, 16, 0, 5), now)).toBe('Sep 16')
  })

  it('adds the year for an earlier one', () => {
    expect(dayLabel(at(11, 30, 20, 0, 2025), now)).toBe('Dec 30, 2025')
  })
})

describe('dayKey and timeOfDay', () => {
  it('reads the local day and the time', () => {
    expect(dayKey(at(8, 16, 0, 5))).toBe('2026-09-16')
    expect(timeOfDay(at(8, 16, 0, 5))).toBe('00:05')
  })
})

describe('minutes', () => {
  it('rounds a length to whole minutes, never to zero', () => {
    expect(minutes(2597)).toBe('43 min')
    expect(minutes(2610)).toBe('44 min')
    expect(minutes(20)).toBe('1 min')
  })
})

describe('endTime', () => {
  it('adds the length to the start', () => {
    expect(timeOfDay(endTime(at(8, 16, 20, 42), 2597))).toBe('21:25')
  })
})
