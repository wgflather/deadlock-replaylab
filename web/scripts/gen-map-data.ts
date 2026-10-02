/**
 * Write the static layout of each map -- where its camps, powerups, Urn, breakables,
 * shops, Rift and structures are -- to src/map/data/, for the map timings page, which
 * shows the map's clock without a replay.
 *
 * Read off a reference replay per map with the viewer's own parser, so the layout is the
 * game's, not hand-placed: a camp is where the replay's camps are (the current map lists
 * them; the old one falls back on the artwork's list, see src/map/camps.ts), a breakable
 * spot is anywhere one ever stood, and so on. Run again when a patch moves things.
 *
 * Usage (from web/):
 *     npx vite-node scripts/gen-map-data.ts <current-map.dem> <old-map.dem>
 */

import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { breakableSpots, campSites } from '../src/demo/mapState'
import type { Breakables, Timeline } from '../src/demo/types'
import { isCurrentMap } from '../src/map/version'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WASM = join(ROOT, 'src', 'wasm')
const OUT = join(ROOT, 'src', 'map', 'data')

type Point = [number, number]

async function parse(file: string): Promise<Timeline> {
  const mod = await import(pathToFileURL(join(WASM, 'deadlock_demo_parser.js')).href)
  await mod.default({ module_or_path: readFileSync(join(WASM, 'deadlock_demo_parser_bg.wasm')) })
  const fd = openSync(file, 'r')
  const size = fstatSync(fd).size
  const json = mod.parse_scoreboard(size, (offset: number, length: number) => {
    const buf = new Uint8Array(Math.min(length, size - offset))
    readSync(fd, buf, 0, buf.length, offset)
    return buf
  })
  closeSync(fd)
  return JSON.parse(json)
}

function spots(list: Breakables | undefined, quant: number): Point[] {
  if (!list?.t.length) return []
  return breakableSpots(list).map((s) => [s.x * quant, s.y * quant])
}

function layout(t: Timeline) {
  const e = t.events
  const q = e.quant
  const urn = [...new Map(e.urn.t.flatMap((_, i) => (e.urn.kind[i] === 'spawn' ? [[e.urn.x[i] < 0 ? 'west' : 'east', [e.urn.x[i] * q, e.urn.y[i] * q] as Point] as const] : []))).entries()]
  const firstUrn = e.urn.kind.indexOf('spawn')
  const rifts = [...new Map(e.rifts.x.map((x, i) => [x < 0 ? 'west' : 'east', [x * q, e.rifts.y[i] * q] as Point])).values()]
  return {
    build: t.build,
    current: isCurrentMap(t.build),
    camps: campSites(t).map((c) => ({ name: c.name, side: c.side, tier: c.tier, x: c.x, y: c.y })),
    powerups: spots(e.powerups, q),
    urn: Object.fromEntries(urn),
    urnFirst: firstUrn < 0 ? 'west' : e.urn.x[firstUrn] < 0 ? 'west' : 'east',
    rifts,
    crates: spots(e.crates, q),
    toughCrates: spots(e.toughCrates, q),
    statues: spots(e.statues, q),
    sinners: spots(e.sinners, q),
    snacks: spots(e.snacks, q),
    shops: (t.shops?.team ?? []).flatMap((team, i) => (team === 4 ? [[t.shops.x[i] * q, t.shops.y[i] * q] as Point] : [])),
    objectives: t.objectives.list.map((o) => ({ kind: o.kind, team: o.team, x: o.x * t.objectives.quant, y: o.y * t.objectives.quant })),
  }
}

async function main() {
  const [current, old] = process.argv.slice(2)
  if (!current || !old) throw new Error('usage: gen-map-data.ts <current-map.dem> <old-map.dem>')
  mkdirSync(OUT, { recursive: true })
  for (const [name, file, wantCurrent] of [
    ['current', current, true],
    ['legacy', old, false],
  ] as const) {
    const data = layout(await parse(file))
    if (data.current !== wantCurrent)
      throw new Error(`${file} is build ${data.build}, not a ${wantCurrent ? 'current' : 'pre-update'} map`)
    const path = join(OUT, `${name}.json`)
    writeFileSync(path, JSON.stringify(data))
    console.log(`wrote ${path} (${Math.round(JSON.stringify(data).length / 1024)} KB, build ${data.build}, ${data.camps.length} camps)`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
