import { useCallback, useEffect, useRef, useState } from 'react'
import type { Timeline, WorkerMessage } from './types'

export type DemoState =
  | { phase: 'idle' }
  | { phase: 'parsing'; fileName: string; fileSize: number }
  | { phase: 'ready'; fileName: string; timeline: Timeline; elapsedMs: number }
  | { phase: 'error'; fileName: string; message: string }

/**
 * Runs one replay through the parser worker.
 *
 * There is no progress figure on purpose. The parser reports nothing between start and
 * finish, and a bar that invents its own position is worse than none; the parse is a few
 * seconds, so the file's name and size carry the wait instead.
 */
export function useDemo() {
  const [state, setState] = useState<DemoState>({ phase: 'idle' })
  const workerRef = useRef<Worker | null>(null)
  // Read inside the worker's message handler, which outlives the call that set it.
  const fileRef = useRef<File | null>(null)

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const parse = useCallback((file: File) => {
    // A second parse while one is running would interleave results; the old worker goes.
    workerRef.current?.terminate()
    fileRef.current = file
    setState({ phase: 'parsing', fileName: file.name, fileSize: file.size })

    const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      const fileName = fileRef.current?.name ?? ''
      if (message.kind === 'done') {
        setState({
          phase: 'ready',
          fileName,
          timeline: message.timeline,
          elapsedMs: message.elapsedMs,
        })
        worker.terminate()
        workerRef.current = null
      } else if (message.kind === 'error') {
        // The parser's own reason ("unreachable" after a panic, a protobuf error) means
        // nothing to most people, so it follows a sentence that does.
        setState({
          phase: 'error',
          fileName,
          message: `Couldn't read ${fileName}. It may be incomplete, not a Deadlock replay, or from a game version this viewer doesn't support yet. (${message.message})`,
        })
        worker.terminate()
        workerRef.current = null
      }
    }

    // A worker that fails to start at all -- a missing wasm file, a syntax error -- never
    // sends a message, so without this the page would sit on "parsing" forever.
    worker.onerror = () => {
      setState({
        phase: 'error',
        fileName: fileRef.current?.name ?? '',
        message: 'The parser failed to start.',
      })
      worker.terminate()
      workerRef.current = null
    }

    worker.postMessage({ file })
  }, [])

  const reset = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    fileRef.current = null
    setState({ phase: 'idle' })
  }, [])

  return { state, parse, reset }
}
