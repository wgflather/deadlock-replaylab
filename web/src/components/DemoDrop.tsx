import { useRef, useState } from 'react'
import type { DemoState } from '../demo/useDemo'

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_048_576).toLocaleString()} MB`
}

/**
 * Where a replay comes in: a drop target that is also a button.
 *
 * Replays live in a folder most people have never opened, so the path to them is spelled
 * out rather than left to a placeholder. The reassurance that the file stays on the
 * machine sits here, at the moment it is being handed over, rather than in a footer.
 */
export function DemoDrop({ state, onFile }: { state: DemoState; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const busy = state.phase === 'parsing'

  function take(files: FileList | null) {
    const file = files?.[0]
    if (file) onFile(file)
  }

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        if (!busy) take(event.dataTransfer.files)
      }}
      className={`ui-panel px-6 py-10 text-center transition-colors ${
        over ? 'border-ui-accent bg-ui-accent-soft' : ''
      }`}
    >
      <h2 className="section-title">Open a replay</h2>
      <p className="text-ui-muted mx-auto mt-3 max-w-prose text-[0.875rem]">
        Drop a <code className="text-ui-fg">.dem</code> file here, or choose one. Your replays are in{' '}
        <code className="text-ui-fg break-all">
          Steam/steamapps/common/Deadlock/game/citadel/replays
        </code>
        .
      </p>
      <p className="text-ui-muted mx-auto mt-2 max-w-prose text-[0.8125rem]">
        To get one, open a match in Deadlock&apos;s match history and download its replay. The
        files are large (often 300–500 MB), so this works best on a desktop.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".dem"
        className="sr-only"
        onChange={(event) => {
          take(event.target.files)
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = ''
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="bg-ui-accent text-ui-on-accent rounded-ui mt-6 px-5 py-2.5 text-[0.875rem] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Reading…' : 'Choose replay'}
      </button>

      {state.phase === 'parsing' && (
        <p className="text-ui-muted mt-4 text-[0.8125rem]" role="status">
          Reading <span className="text-ui-fg">{state.fileName}</span> ({megabytes(state.fileSize)})…
        </p>
      )}

      {state.phase === 'error' && (
        <p className="text-data-damage mt-4 text-[0.8125rem]" role="alert">
          {state.message}
        </p>
      )}

      <p className="text-ui-faint mt-6 text-[0.75rem]">
        The file is read in your browser and never uploaded.
      </p>
    </section>
  )
}
