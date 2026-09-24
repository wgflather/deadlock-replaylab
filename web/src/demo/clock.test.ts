import { describe, expect, it } from 'vitest'
import type { Timeline } from './types'
import { clock, gameClock, gameSeconds, recordingSeconds } from './usePlayback'

describe('clock', () => {
  it('reads minutes and seconds, and a countdown before 0:00 the way the game shows it', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(185.9)).toBe('3:05')
    expect(clock(-30)).toBe('-0:30')
  })
})

describe('gameClock', () => {
  it('shows a recording time on the in-game clock', () => {
    // The replay starts in the pre-game countdown, thirty seconds before 0:00.
    const timeline = { clockStart: 30 } as Timeline
    expect(gameClock(timeline, 0)).toBe('-0:30')
    expect(gameClock(timeline, 210)).toBe('3:00')
  })

  // As measured on a real match: a 33 s pause at 5:23.
  const paused = {
    clockStart: 30,
    clock: [
      { t: 0, game: -30, paused: false },
      { t: 353, game: 323, paused: true },
      { t: 386, game: 323, paused: false },
    ],
  } as Timeline

  it('stops for a pause and carries on after it', () => {
    expect(gameClock(paused, 350)).toBe('5:20')
    expect(gameClock(paused, 370)).toBe('5:23')
    expect(gameClock(paused, 386 + 37)).toBe('6:00')
  })

  it('finds where the clock read a time, either side of a pause', () => {
    expect(recordingSeconds(paused, 180)).toBe(210)
    expect(recordingSeconds(paused, 600)).toBe(663)
    expect(gameSeconds(paused, recordingSeconds(paused, 600))).toBe(600)
  })
})
