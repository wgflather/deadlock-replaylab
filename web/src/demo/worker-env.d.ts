/**
 * The few worker globals the parser worker needs.
 *
 * Declared here rather than by adding the "webworker" lib to tsconfig: that lib and
 * "DOM" both define `self`, `postMessage` and friends with different types, and having
 * both in one program makes every file ambiguous. The app is a DOM program with one
 * worker in it, so the worker's own globals are spelled out instead.
 */

/** Reads a Blob synchronously. Exists only inside a worker, which is why the parse is one. */
declare class FileReaderSync {
  readAsArrayBuffer(blob: Blob): ArrayBuffer
}

declare interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<never>) => void) | null
  postMessage(message: unknown): void
}
