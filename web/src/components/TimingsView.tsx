import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePlayback } from '../demo/usePlayback'
import { TIMINGS_DURATION, timingRules, timingsMatch, type MapVersion } from '../map/timings'
import { MapFlow } from './MapFlow'
import { MapView } from './MapView'
import { PlaybackBar } from './PlaybackBar'

/** Seconds the arrow keys step the playhead by, as in a replay. */
const ARROW_SECONDS = 5

const RULES_NOTE =
  'The same in every match, on the game clock. On the map, only what runs on the clock is played out: once something is up it stays up here, since when it comes back depends on who takes it. Turn on Cycle to see each one taken as it appears.'
const CYCLE_NOTE =
  'The same in every match, on the game clock. Cycling: each thing is taken the moment it appears and comes back after its usual delay, the soonest it can ever return. The Mid-Boss falls at 10:00, the earliest guides have it fought. The Rift and the Broker come when the game decides, so they are not played out.'

/**
 * The map's clock, with no replay: an hour of the map running on its own timers -- camps
 * coming up, powerups dropping, the Urn alternating sides -- on the viewer's own map,
 * with the same side panel the Map flow tab has. For learning the rhythm of the map
 * before (or instead of) watching a match. See ../map/timings for what is and is not
 * played out.
 */
export function TimingsView({ brand, onClose }: { brand: ReactNode; onClose: () => void }) {
  const [version, setVersion] = useState<MapVersion>('current')
  const [cycle, setCycle] = useState(false)
  const match = useMemo(() => timingsMatch(version, cycle), [version, cycle])
  const rules = useMemo(() => timingRules(version), [version])
  const playback = usePlayback(match)

  // A new stand-in match starts its playhead at 0; switching map or cycling should not
  // lose the moment being looked at, so it is put back.
  const keep = useRef<number | null>(null)
  const change = (apply: () => void) => {
    keep.current = playback.frame
    apply()
  }
  useEffect(() => {
    if (keep.current !== null) {
      playback.seek(keep.current)
      keep.current = null
    }
  }, [match, playback])

  const { toggle, seek, frame, count } = playback
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === ' ' && target?.closest('button')) return
      if (event.key === ' ') toggle()
      else if (event.key === 'ArrowLeft') seek(Math.max(0, frame - ARROW_SECONDS))
      else if (event.key === 'ArrowRight') seek(Math.min(count - 1, frame + ARROW_SECONDS))
      else if (event.key === 'Escape') onClose()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, seek, frame, count, onClose])

  return (
    <div className="flex min-h-screen flex-col lg:h-dvh lg:min-h-0">
      <header className="border-ui-line flex items-center justify-between gap-4 border-b px-4 py-2">
        <div className="flex items-center gap-6">
          {brand}
          <span className="text-ui-fg text-[0.8125rem]">Map timings</span>
        </div>
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="Map" className="flex gap-1 text-[0.8125rem]">
            {(
              [
                ['current', 'Current map'],
                ['legacy', 'Before the 2026-10 update'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={version === id}
                onClick={() => change(() => setVersion(id))}
                className={`rounded-ui px-2 py-1 ${
                  version === id ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={cycle}
            onClick={() => change(() => setCycle((on) => !on))}
            title="Take everything as it appears, so each respawn timer keeps running"
            className={`ui-button px-2.5 py-1 text-[0.8125rem] ${cycle ? 'text-ui-accent' : ''}`}
          >
            Cycle {cycle ? 'on' : 'off'}
          </button>
          <button type="button" onClick={onClose} className="ui-button px-2.5 py-1 text-[0.8125rem]">
            Open a replay
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-2 lg:flex-row lg:justify-center lg:p-4 lg:pt-3 lg:[container-type:size]">
        <div className="relative w-full shrink-0 lg:w-[min(100cqh,calc(100cqw-24.5rem))]">
          <MapView
            timeline={match}
            at={playback.seconds}
            speed={playback.speed}
            selected={null}
            onSelect={() => {}}
            playing={playback.playing}
            players={false}
            ghosts={cycle}
            transport={
              <PlaybackBar
                timeline={match}
                frame={playback.frame}
                at={playback.seconds}
                playing={playback.playing}
                speed={playback.speed}
                onSeek={playback.seek}
                onToggle={playback.toggle}
                onSpeed={playback.setSpeed}
              />
            }
          />
        </div>
        <aside aria-label="Map timings" className="flex min-h-0 shrink-0 flex-col lg:max-h-full lg:w-[23rem]">
          <MapFlow
            timeline={match}
            at={playback.seconds}
            onSeek={playback.seek}
            rules={rules}
            rulesNote={cycle ? CYCLE_NOTE : RULES_NOTE}
            clock
            strips={false}
          />
        </aside>
      </div>
      <p className="sr-only">{`An hour (${TIMINGS_DURATION / 60} minutes) of the map's clock.`}</p>
    </div>
  )
}
