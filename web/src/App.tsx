import { useEffect, useState, type ReactNode } from 'react'
import { DemoDrop } from './components/DemoDrop'
import { MapView } from './components/MapView'
import { PerformanceChart } from './components/PerformanceChart'
import { PlaybackBar } from './components/PlaybackBar'
import { PlayerInspector } from './components/PlayerInspector'
import { Scoreboard } from './components/Scoreboard'
import { TopHud } from './components/TopHud'
import type { Timeline } from './demo/types'
import { useDemo } from './demo/useDemo'
import { usePlayback } from './demo/usePlayback'

/** The content column for the pages around a replay: opening one, and its errors. */
const SHELL = 'mx-auto w-full max-w-7xl px-4 sm:px-6'

/** Seconds the arrow keys step the playhead by. */
const ARROW_SECONDS = 5

/*
 * A replay viewer. A match comes from a .dem file the viewer opens, parsed in the
 * browser by the wasm parser in demo-parser/ -- there is no server in this path, and
 * nothing about the replay leaves the machine.
 */
export default function App() {
  const demo = useDemo()
  const timeline = demo.state.phase === 'ready' ? demo.state.timeline : null

  const brand = (
    <span className="text-ui-fg text-[0.9375rem] leading-none font-semibold">Deadlock ReplayLab</span>
  )

  if (timeline && demo.state.phase === 'ready') {
    return (
      <ReplayView
        timeline={timeline}
        brand={brand}
        fileName={demo.state.fileName}
        onOpenAnother={demo.reset}
      />
    )
  }

  return (
    <div className="min-h-screen">
      <header className="border-ui-line border-b">
        <div className={`${SHELL} flex items-center py-3`}>{brand}</div>
      </header>
      <main className={`${SHELL} pt-6 pb-24`}>
        <DemoDrop state={demo.state} onFile={demo.parse} />
      </main>
      <footer className={`${SHELL} text-ui-faint pb-8 text-[0.75rem]`}>
        A fan project, not affiliated with or endorsed by Valve. Deadlock and its hero,
        ability and map art belong to Valve Corporation. Replays are parsed with{' '}
        <a href="https://github.com/blukai/haste" className="hover:text-ui-muted underline">
          haste
        </a>{' '}
        (
        <a
          href={`${import.meta.env.BASE_URL}third-party-licenses.txt`}
          className="hover:text-ui-muted underline"
        >
          licenses
        </a>
        ).
      </footer>
    </div>
  )
}

/**
 * The replay, laid out like a spectator's screen rather than a page: the match overview
 * across the top, the map filling what is left, and one player opened in a panel beside
 * it. On a wide screen it fits the window exactly and nothing scrolls but the panel; on
 * a narrow one it stacks and the page scrolls as usual.
 *
 * The keyboard drives it the way a video player's does -- Space plays and pauses, the
 * arrows step five seconds -- plus S for the full scoreboard and Escape to close
 * whichever of the scoreboard or the player panel is open.
 */
function ReplayView({
  timeline,
  brand,
  fileName,
  onOpenAnother,
}: {
  timeline: Timeline
  brand: ReactNode
  fileName: string
  onOpenAnother: () => void
}) {
  const playback = usePlayback(timeline)
  // The player open in the panel, as an index into `timeline.players`.
  const [selected, setSelected] = useState<number | null>(null)
  const [boardOpen, setBoardOpen] = useState(false)
  // What the stage shows: the match on the map, or its numbers over time.
  const [view, setView] = useState<'map' | 'performance'>('map')
  // Nobody is inspected in a newly opened match. Reset during render, the way
  // usePlayback resets its playhead, so the old index never reaches the new match.
  const [selectedIn, setSelectedIn] = useState(timeline)
  if (selectedIn !== timeline) {
    setSelectedIn(timeline)
    setSelected(null)
    setBoardOpen(false)
  }

  const { toggle, seek, frame, count } = playback
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      // Typing, and the scrubber's own arrow keys, stay theirs. So does Space on a
      // button, which already means "press this".
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === ' ' && target?.closest('button')) return

      if (event.key === ' ') toggle()
      else if (event.key === 'ArrowLeft') seek(Math.max(0, frame - ARROW_SECONDS))
      else if (event.key === 'ArrowRight') seek(Math.min(count - 1, frame + ARROW_SECONDS))
      else if (event.key === 's' || event.key === 'S') setBoardOpen((open) => !open)
      else if (event.key === 'Escape') {
        if (boardOpen) setBoardOpen(false)
        else setSelected(null)
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, seek, frame, count, boardOpen])

  const rows = playback.rows
  if (!rows) return null
  const row = selected === null ? undefined : rows[selected]

  return (
    <div className="flex min-h-screen flex-col lg:h-dvh lg:min-h-0">
      <header className="border-ui-line flex items-center justify-between gap-4 border-b px-4">
        <div className="flex items-center gap-6">
          {brand}
          {/* The two views of the match. Tabs in the application's own vocabulary: the
              selected one underlined in its accent. */}
          <div role="tablist" aria-label="View" className="flex gap-1">
            {(
              [
                ['map', 'Map'],
                ['performance', 'Performance'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`border-b-2 px-2 py-2.5 text-[0.8125rem] transition-colors ${
                  view === id
                    ? 'border-ui-accent text-ui-fg'
                    : 'text-ui-muted hover:text-ui-fg border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-ui-faint hidden truncate text-[0.8125rem] sm:inline">
            {fileName}
          </span>
          <button
            type="button"
            onClick={onOpenAnother}
            className="ui-button px-2.5 py-1 text-[0.8125rem]"
          >
            Open another
          </button>
        </div>
      </header>

      <div className="px-2 pt-2 lg:px-4 lg:pt-3">
        <TopHud
          timeline={timeline}
          rows={rows}
          at={playback.seconds}
          selected={selected}
          onSelect={setSelected}
          boardOpen={boardOpen}
          onBoard={() => setBoardOpen((open) => !open)}
        />
      </div>

      {/*
        The stage: the player panel and the map side by side, centred as a pair. The stage
        is a size container, so the map can be as large a square as fits beside the panel
        -- the smaller of the height and whatever width the panel leaves.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-2 lg:flex-row lg:justify-center lg:p-4 lg:pt-3 lg:[container-type:size]">
        {/*
          The player panel opens on the left, the side the scoreboard never was, and the
          map moves over for it rather than being covered: both are for reading at once.
        */}
        {row && selected !== null && (
          <aside
            aria-label="Player"
            className="order-last min-h-0 shrink-0 lg:order-none lg:max-h-full lg:w-[23rem] lg:overflow-y-auto motion-safe:animate-[panel-in_180ms_ease-out]"
          >
            <PlayerInspector
              timeline={timeline}
              player={selected}
              row={row}
              at={playback.seconds}
              onClose={() => setSelected(null)}
            />
          </aside>
        )}

        {/*
          The map is a square as large as fits; the performance chart is a plot, and takes
          all the width there is.
        */}
        <div
          className={`relative w-full ${
            view === 'performance'
              ? 'min-h-0 min-w-0 lg:flex-1'
              : row
                ? 'shrink-0 lg:w-[min(100cqh,calc(100cqw-24.5rem))]'
                : 'shrink-0 lg:w-[min(100cqw,100cqh)]'
          }`}
        >
          {view === 'map' ? (
            <MapView
              timeline={timeline}
              at={playback.seconds}
              speed={playback.speed}
              selected={selected}
              onSelect={setSelected}
              playing={playback.playing}
              transport={
                <PlaybackBar
                  timeline={timeline}
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
          ) : (
            <PerformanceChart
              timeline={timeline}
              at={playback.seconds}
              focus={selected}
              onSeek={playback.seek}
            />
          )}

          {/* The full table, over the stage the way the game lays it over play. */}
          {boardOpen && (
            <div
              role="dialog"
              aria-label="Scoreboard"
              className="bg-ui-bg/95 absolute inset-0 z-20 overflow-y-auto p-3 lg:p-6"
            >
              <div className="mx-auto max-w-6xl">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="section-title">Scoreboard</h2>
                  <button
                    type="button"
                    onClick={() => setBoardOpen(false)}
                    className="ui-button px-2 py-1 text-[0.75rem]"
                  >
                    Close <kbd className="text-ui-faint font-sans">Esc</kbd>
                  </button>
                </div>
                <Scoreboard
                  rows={rows}
                  selected={selected}
                  onSelect={(player) => {
                    setSelected(player)
                    setBoardOpen(false)
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
