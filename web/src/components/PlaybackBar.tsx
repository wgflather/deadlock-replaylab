import { useMemo } from 'react'
import { killMarks } from '../demo/events'
import { AMBER, SAPPHIRE, type Timeline } from '../demo/types'
import { gameClock, SPEEDS, type Speed } from '../demo/usePlayback'

/** The native range thumb's width in pixels, which the kill marks inset by half at each
 * end: a value's position on the track runs between the thumb's two resting centres,
 * not edge to edge. 16 is Chromium's and Firefox's default. */
const THUMB = 16

/**
 * The transport, laid out the way a video player's is: the scrubber runs the full width
 * of the screen, and play, time and speed sit on a row beneath it, on a plain bar along
 * the bottom of the map. Neutral throughout: the only colour on it is the kill marks,
 * which are data, and the cream of the play button and playhead, which are the
 * controls.
 *
 * The scrubber is a range input rather than a drawn track, so dragging, arrow keys and
 * Home/End all work without being reimplemented. It is indexed by frame rather than by
 * seconds, because every position it can take is a frame that exists -- and at one frame
 * per second of match time those are the same thing.
 *
 * Every death is marked on the track, in the colour of the side that got the kill, so a
 * fight can be found by eye and scrubbed to rather than played through to.
 */
export function PlaybackBar({
  timeline,
  frame,
  at,
  playing,
  speed,
  onSeek,
  onToggle,
  onSpeed,
}: {
  timeline: Timeline
  frame: number
  /** Seconds into the match. */
  at: number
  playing: boolean
  speed: Speed
  onSeek: (frame: number) => void
  onToggle: () => void
  onSpeed: (speed: Speed) => void
}) {
  const last = timeline.frames - 1
  const marks = useMemo(() => killMarks(timeline), [timeline])
  const fraction = (seconds: number) => Math.min(seconds / Math.max(timeline.duration, 1), 1)

  return (
    <div className="bg-ui-surface/95 border-ui-line border-t px-3 pt-2 pb-2">
      <div className="relative flex items-center">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2">
          {marks.map((mark, i) => (
            <span
              key={i}
              className="absolute h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${fraction(mark.seconds)})`,
                // The killing side: whichever team the victim was not on.
                background:
                  mark.victimTeam === AMBER
                    ? 'var(--data-team-sapphire)'
                    : mark.victimTeam === SAPPHIRE
                      ? 'var(--data-team-amber)'
                      : 'var(--data-neutral)',
                opacity: 0.85,
              }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={Math.min(frame, last)}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Match time"
          aria-valuetext={gameClock(timeline, at)}
          className="relative h-1 w-full cursor-pointer"
        />
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          className="bg-ui-accent text-ui-on-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-90"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
            {playing ? (
              <path d="M4 3h3v10H4zM9 3h3v10H9z" />
            ) : (
              <path d="M5 2.8v10.4a.5.5 0 0 0 .76.43l8.2-5.2a.5.5 0 0 0 0-.86l-8.2-5.2A.5.5 0 0 0 5 2.8z" />
            )}
          </svg>
        </button>

        <p className="flex items-baseline gap-1.5">
          <span className="text-ui-fg text-[0.875rem] leading-none font-medium">{gameClock(timeline, at)}</span>
          <span className="text-ui-muted text-[0.75rem]">/ {gameClock(timeline, timeline.duration)}</span>
        </p>

        <div className="ml-auto flex shrink-0 gap-0.5" role="group" aria-label="Playback speed">
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onSpeed(option)}
              aria-pressed={option === speed}
              className={`rounded-[4px] px-1.5 py-1 text-[0.75rem] transition-colors ${
                option === speed ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
              }`}
            >
              {option}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
