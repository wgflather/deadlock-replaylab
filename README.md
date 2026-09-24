# Deadlock ReplayLab

A replay viewer for Deadlock. Drop a `.dem` file in and watch the match back on the
minimap: players, lanes, objectives, camps and timers, kills and casts, a scoreboard with
each player's ranked badge, and a per-player inspector for items, souls and damage.

**Nothing is uploaded.** The replay is parsed in your browser, by a WebAssembly build of
[haste](https://github.com/blukai/haste) running in a worker. The page is static; there is
no server behind it.

## Getting a replay

Open a match in Deadlock's match history and download its replay. Downloaded replays are
in `Steam/steamapps/common/Deadlock/game/citadel/replays`. They are large (often
300–500 MB), so the viewer is meant for a desktop browser.

Only ranked matches carry ranks; an unranked replay shows none.

## Layout

- `web/` — the viewer (React, TypeScript, Vite, Tailwind).
- `demo-parser/` — the Rust parser, built to wasm into `web/src/wasm`. The built output
  is committed, so working on the viewer needs only Node.

```sh
cd web
npm install
npm run dev        # the viewer, on http://localhost:5173
npm test
```

Changing the parser needs Rust with the `wasm32-unknown-unknown` target, `wasm-bindgen`,
and `protoc` on PATH (or `$PROTOC` pointing at it):

```sh
cd web
npm run wasm:build
```

## Notable choices

**The parser pulls the file, one window at a time.** It asks for bytes through a
synchronous callback, which a worker answers with `FileReaderSync` on a slice of the
`File`. A half-gigabyte replay is never held in memory whole.

**The timeline is columnar.** The parser returns one array per statistic per player,
indexed by frame, rather than a list of per-frame objects, which would cost many times
more to send across from the worker and to keep.

**Replays can break with game patches.** The parser reads the entity layout from each
replay, so most patches just work. New heroes and items need their icons added, and a
change to a message the parser decodes by hand can stop a replay from loading. Such a
replay shows an error rather than a partial match.

## Credits

A fan project, not affiliated with or endorsed by Valve. Deadlock and its hero, ability
and map art belong to Valve Corporation. Parsing is built on
[haste](https://github.com/blukai/haste) (BSD-3-Clause); see
`web/public/third-party-licenses.txt`.
