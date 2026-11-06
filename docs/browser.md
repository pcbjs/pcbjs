# Browser compile

The compiler in a page: `@pcbjs/compile/browser` runs the stage graph in a Web Worker on files held in memory and streams the facets as they end, equal to Node's compile byte for byte.
Advanced. Read it to compile a board in a browser, to know what of the compiler runs there and what cannot, and how the equality with Node is kept; design.md has the platform beneath it.

```ts
import { compileInBrowser, type BrowserModule } from '@pcbjs/compile/browser'

declare const board: BrowserModule
// compile-worker.ts is one line: import '@pcbjs/export/browser-worker'
const worker = () => new Worker(new URL('./compile-worker.ts', import.meta.url), { type: 'module' })
compileInBrowser(board, { worker, want: ['layers', 'findings'], facet: f => console.log(f.board, f.facet, f.hash) }).then(r => console.log(r.ms, r.check.ok))
```

## What runs and what cannot

- Runs: evaluating the design and its config, every stage through `checks` with `want` and a cancel, the facets `meta`, `sch`, `layers`, `model` and `findings`, DRC and ERC, `model-missing` included, outline fonts, KiCad footprints, `reference()` of a board the module carries, the route memo of a board.
- Cannot: the `exports` stage, so no fab set, SVG file, GLB or raster, which need Node's zlib, sharp and a child process; STEP to mesh, which is OpenCascade in Node; the scope and source range transforms and the typecheck, which run when the module is built; a `reference()` the module does not carry, which compiles another entry in a child process; fetching a `kicad:`, `lcsc:` or https model; discovering KiCad libraries beyond the files given; the user model cache.
- A read of a file the module does not name finds nothing, as a missing file in Node; `reference()` of an entry it does not carry fails with `not available in the browser compile: <path>`.

## The module

`BrowserModule` is one entry ready for a browser compile, its paths virtual under `root`, `/project`:

| Field | What it holds |
| --- | --- |
| `format` | 1 |
| `root` | the virtual project root |
| `project` | names the project, every entry of it alike; one worker keeps each project's parts, bound routes and defaults apart by it, as `inRealm` does in Node; default the config's URL, else the module's |
| `entry` | the entry relative to the root, as the CLI names it |
| `config` | the config as browser ESM, evaluated first for its defaults, plugins and `kicad` folders |
| `module` | the design as browser ESM, its default export the board |
| `patches` | the entry's `.patches.ts` as browser ESM, when it has one |
| `modules` | every built module of the project's own sources, whose stack frames map back through their source maps |
| `sources` | the sha1 of each source module, which keys the stage cache |
| `files` | fonts, KiCad footprints and model files by virtual path: a URL fetched before the compile, or `null` for a file that only has to exist |
| `routes` | route memos by board name, URLs of `.pcbjs/cache/route/<board>.json` |
| `references` | each referenced board by absolute virtual entry, URLs of its `ReferencedBoard` JSON |
| `meshes` | the mesh hash Node gave each STEP model of `files`, by virtual path, so a model whose content the module leaves out names the mesh beside the site; a fetched model resolves to its file under `.pcbjs/models/fetched` as the CLI keeps it |
| `env` | what the compile reads of the environment |
| `generatedAt` | the one timestamp of the facets |
| `expect` | `checkHash` of each facet the Node compile gave, its root written `/project`, by `board/target/facet` |
| `math` | how the Node that built the module rounds its Math, `plain` or `fused` |

- `?pcb:module` of `@pcbjs/cli/vite` builds one, ui.md, and so does the equality test, both through the CLI's module build. The modules carry the CLI's transforms: the scope injection and source ranges before esbuild, as Vite's SSR applies them, so parts take their names and items their source ranges as in Node.
- They are bundled with esbuild and `keepNames`, one build per project, config and entries sharing chunks. A bundler that renames a function expression shadowing its own constant, as Rollup does with `const TestPad = defineFootprint(function TestPad…`, changes the name a part is labelled by. The transform of each file renames such a function the way Vite's does, and keeping names then keeps that.
- The build defines `process.env` as an empty object, so a design reading the environment reads none in the browser. The site build of `boards: 'compile'` leaves the pcbjs packages out of each project and imports them from one shared build under `pcb/lib/`.
- A source map names its sources by virtual path: `/project/…` for the project, `/node_modules/@pcbjs/…` for a package, whose frames are never a call site.

## The worker

- `@pcbjs/export/browser-worker` is the module Web Worker; `serveCompile(port, { stream })` of `@pcbjs/compile/browser` is its runtime, and export's `facetStream` the facets. One worker serves a page, one compile at a time.
- To the worker: `{ t: 'compile', id, module, want?, boards? }`, and once `{ t: 'init', flag }` with a `SharedArrayBuffer` under `crossOriginIsolated`.
- From it: `{ t: 'ready', check }` on load, then per compile `{ t: 'stage', id, s }` as each stage starts, ends or hits, `{ t: 'facet', id, f }` as each facet is made, `{ t: 'board', id, board, target?, json }` per target when `boards` asks, and `{ t: 'done', id, ms, mismatch?, error? }`. `s`, `f` and `error` have the session worker's shapes.
- Facets come in stage order: `meta`, `layers`, `shapes` and `model` after `place`, `sch` after `schematic`, `layers` and `shapes` after `tune` and `finish`, and `findings` after `checks`.
- `compileInBrowser(module, { worker, want, boards, facet, stage, signal })` keeps one worker per factory and resolves with every facet, the boards asked for, the self-check and any mismatch. A cancel through `signal` raises the shared flag, or without one ends the worker; the next compile starts another, the runtime coming from the HTTP cache.
- The worker keeps its own stage cache and route memos in memory, keyed by its own hashes; it never reads or writes Node's cache. A board's route memo seeds it, so no leg routes cold.

## Math

- Chromium builds V8 with another libm than Node does: `Math.sin`, `exp`, `log`, `atan2` and the rest differ from Node's in the last bit for a few inputs in a hundred, and a board's arcs, rotations and pours with them.
- The worker installs the fdlibm of V8's `base/ieee754.cc` in JavaScript, so its Math is Node's bit for bit. Node built by clang for arm64 fuses `a*b + c` into one rounding where the source writes it, and x86-64 builds do not; `mathKind()` in Node names which, and the module's `math` picks the same in the worker.
- `Math.pow` and `Math.hypot` are V8's own in both and need nothing.

## Self-check

- On load the worker compiles a small fixture, a circle board with rotated parts, a route and a pour, with the plain Math, and compares its hash with `SELF_CHECK_HASH.plain`, an x86-64 Node's. A mismatch logs one warning; the compile still runs and shows the browser's result.
- A module with `expect` is checked facet by facet with `checkHash`, the facet's hash without the router's own counts `cached`, `ripped` and `rounds`, which tell a warm compile from a cold one; the facets that differ come back in `mismatch`, with one warning naming them.
- Firefox and Safari are not gated. Their Math is fdlibm too once the worker installs it, so a mismatch there means another engine difference, which the self-check reports.

## The equality test

`node scripts/browser-equality.mjs [--port <n>] [--devtools <n>] [--dump <dir>] [project …]` compiles the demo boards and highspeed in Node through the CLI and in a headless Chromium through the worker, and compares each target's board JSON, finding ids and `inspect --lengths` byte for byte, Node's project root written as `/project`. The router's own counts, `cached`, `ripped` and `rounds`, tell a warm compile from a cold one and are left out, as stage-equality leaves them out.

- Chromium is `$PCBJS_CHROME`, else Chrome, Chromium or Edge in the usual places, else a Playwright download; one that exits at once gives way to the next. Without one the script prints a notice and exits 0.
- It drives the browser over the DevTools protocol with Node's own WebSocket, no Playwright or Puppeteer.
- The Node side runs from a folder named `node_modules`, so no route takes the test as its caller, as none takes the CLI.
- CI's dedicated `browser` job runs this check once on Linux with Chromium set up. It is not repeated inside the package test suite.
