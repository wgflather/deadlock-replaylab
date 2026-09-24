/**
 * Builds the wasm parser into web/src/wasm.
 *
 * haste generates its protobuf code at build time, so `protoc` has to be on PATH (or
 * $PROTOC pointing at it). The output is committed, so a plain `npm install && npm run
 * build` in web/ does not need a Rust toolchain at all -- only changing the parser does.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const wasm = join(here, 'target/wasm32-unknown-unknown/release/deadlock_demo_parser.wasm')
const out = join(here, '../web/src/wasm')

// No shell: both tools are plain executables, and on Windows a shell re-splits the
// arguments on spaces, which breaks as soon as the checkout sits under a path like
// "D:\Idea Projects".
const run = (cmd, args) => execFileSync(cmd, args, { cwd: here, stdio: 'inherit' })

run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'])
run('wasm-bindgen', ['--target', 'web', '--out-dir', out, wasm])

console.log(`\nwasm written to ${out}`)
