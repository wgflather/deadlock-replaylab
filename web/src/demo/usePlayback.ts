import { useCallback, useEffect, useMemo, useState } from 'react'
import { rowsAt, type Timeline } from './types'

/**
 * Playback speeds, as multiples of real time.
 *
 * 1x is real time now that a scoreboard frame is a second of match time. A match runs
 * over half an hour, so the ladder reaches far enough that the whole of one can be
 * watched without the scrubber being the only practical way to move.
 */
export const SPEEDS = [1, 2, 4, 8, 16] as const
export type Speed = (typeof SPEEDS)[number]

/**
 * Walks the match forward.
 *
 * The playhead is kept as match *seconds* rather than as a frame number, because the two
 * streams are sampled at different rates: the scoreboard once a second, positions eight
 * times a second. A frame counter fine enough for one is wrong for the other, so each
 * derives what it needs from a single continuous clock.
 *
 * Driven by `requestAnimationFrame` against a wall clock rather than a fixed interval, so
 * the playhead keeps match time even when a frame is late, and stops dead when the tab is
 * backgrounded -- which is what a viewer expects on returning to it.
 */
export function usePlayback(timeline: Timeline | null) {
  const [seconds, setSeconds] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)

  const sampleSeconds = timeline?.sampleSeconds ?? 1
  const count = timeline?.frames ?? 0
  const duration = timeline?.duration ?? 0

  // A new replay starts from the beginning, paused. Adjusted during render rather than
  // in an effect: an effect would let one frame of the new match draw at the old match's
  // playhead before correcting itself.
  const [loaded, setLoaded] = useState(timeline)
  if (loaded !== timeline) {
    setLoaded(timeline)
    setSeconds(0)
    setPlaying(false)
  }

  useEffect(() => {
    if (!playing || duration <= 0) return

    let request = 0
    let last = performance.now()

    const step = (now: number) => {
      const elapsed = (now - last) / 1000
      last = now
      setSeconds((was) => {
        const next = was + elapsed * speed
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
      request = requestAnimationFrame(step)
    }

    request = requestAnimationFrame(step)
    return () => cancelAnimationFrame(request)
  }, [playing, speed, duration])

  const frame = Math.max(0, Math.min(Math.floor(seconds / sampleSeconds), count - 1))

  const seek = useCallback(
    (nextFrame: number) => {
      setSeconds(nextFrame * sampleSeconds)
    },
    [sampleSeconds],
  )

  const toggle = useCallback(() => {
    // Pressing play at the end replays from the start rather than doing nothing.
    setPlaying((was) => {
      if (!was && seconds >= duration) setSeconds(0)
      return !was
    })
  }, [seconds, duration])

  // Rebuilt only when the scoreboard's own frame changes, not on every animation frame.
  const rows = useMemo(() => (timeline ? rowsAt(timeline, frame) : null), [timeline, frame])

  return {
    /** The scoreboard's frame index. */
    frame,
    rows,
    /** Match time in seconds, continuous -- what the position stream is read with. */
    seconds,
    playing,
    speed,
    setSpeed,
    seek,
    toggle,
    count,
  }
}

/** `m:ss`, for a position in the match. */
export function clock(seconds: number): string {
  // Before 0:00 -- the pre-game countdown -- reads the way the game shows it: -0:30.
  const sign = seconds < 0 ? '-' : ''
  const whole = Math.floor(Math.abs(seconds))
  return `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * The in-game clock's reading, in seconds, at `seconds` into the recording. The recording
 * begins about thirty seconds before the match does, and keeps running through pauses,
 * which the game's clock does not.
 */
export function gameSeconds(timeline: Timeline, seconds: number): number {
  const anchors = timeline.clock
  if (!anchors?.length) return seconds - timeline.clockStart
  let at = anchors[0]
  for (const anchor of anchors) {
    if (anchor.t > seconds) break
    at = anchor
  }
  return at.game + (at.paused && seconds >= at.t ? 0 : seconds - at.t)
}

/** Where in the recording the in-game clock read `game` seconds: `gameSeconds` reversed. */
export function recordingSeconds(timeline: Timeline, game: number): number {
  const anchors = timeline.clock
  if (!anchors?.length) return game + timeline.clockStart
  for (let i = 0; i < anchors.length; i++) {
    const at = anchors[i]
    const next = anchors[i + 1]
    if (at.paused || game < at.game) continue
    const t = at.t + (game - at.game)
    if (!next || t <= next.t) return t
  }
  return game + timeline.clockStart
}

/** A moment of the match on the in-game clock: the clock a player saw. */
export function gameClock(timeline: Timeline, seconds: number): string {
  return clock(gameSeconds(timeline, seconds))
}
