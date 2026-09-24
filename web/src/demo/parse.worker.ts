/**
 * Parses a replay off the main thread.
 *
 * This has to be a worker, and not for the usual reason. The parser pulls the file
 * through a callback that must return bytes *synchronously*, and the only synchronous
 * way to read a `File` in a browser is `FileReaderSync`, which exists solely in a worker.
 * Parsing on the main thread would also freeze the page for the length of the parse --
 * seconds, on a half-gigabyte replay.
 *
 * Nothing is uploaded. The file is read from the user's disk into this worker and the
 * only thing that leaves is the scoreboard timeline.
 */
import init, { parse_scoreboard } from '../wasm/deadlock_demo_parser'
import type { WorkerMessage } from './types'

// `self` is typed as a Window by the DOM lib; in here it is the worker scope.
const scope = self as unknown as DedicatedWorkerScope

const reader = new FileReaderSync()

function post(message: WorkerMessage) {
  scope.postMessage(message)
}

scope.onmessage = ((event: MessageEvent<{ file: File }>) => {
  const { file } = event.data
  void (async () => {
    try {
      await init()

      const started = performance.now()
      /*
       * Hands the parser one window of the file at a time. Slicing a File does not read
       * it -- the slice is a view, and only this read pulls those bytes off disk -- so
       * the replay is never held in memory in full, on either side of the wasm boundary.
       */
      const readChunk = (offset: number, length: number): Uint8Array => {
        const end = Math.min(offset + length, file.size)
        return new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, end)))
      }

      const json = parse_scoreboard(file.size, readChunk)
      post({ kind: 'done', timeline: JSON.parse(json), elapsedMs: performance.now() - started })
    } catch (error) {
      // The wasm side throws strings; anything else here is a DOM exception from the read.
      post({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })()
}) as DedicatedWorkerScope['onmessage']

post({ kind: 'ready' })
