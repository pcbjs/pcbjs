# Quick start

Install, make a project, and run the edit and check loop.
Read this first; cli.md has every command, routing.md and autorouter.md the most common findings.

```sh
npx pcbjs create my-board
cd my-board
npm install                                # the @pcbjs packages the template lists
npx pcbjs check                            # compile, route, DRC and ERC of the entries, no files; --watch prints what changed
npx pcbjs inspect U1                       # absolute positions; name the entry first with several: inspect coin.pcb.tsx U1
npm run dev                                # live viewer on http://localhost:5173
npm run build                              # once check says ok: fab set in .pcbjs/fab/my-board, site in .pcbjs/dist
```

## Install

Node 22.12 or newer. Until 0.1 name the `@beta` tag; `latest` is a placeholder with no code.

```sh
npm install -D @pcbjs/pcbjs@beta
```

From source: clone https://github.com/pcbjs/pcbjs, `npm install`, `npm run build`; a project made under `examples/` with `npx pcbjs create` joins the workspace, see docs/development.md.

## `pcbjs create <dir>`

Copies the `board` template into a new or empty directory, named after it.

| File | What |
| --- | --- |
| `pcb.tsx` | the board, below |
| `pcb.config.ts` | `entries: ['pcb.tsx']` |
| `package.json` | `dev`, `build`, `preview`; @pcbjs at the CLI's dist-tag, `beta`, or `~0.1.0` style for a release |
| `tsconfig.json`, `.gitignore`, `README.md` | |

Flags, in cli.md: `--layers`, `--fab`, `--size`, `--outline`, as `pcbjs create my-board --layers 4 --size 50x40`; `--example <name>`, listed by `pcbjs create --list-examples`.

## tsconfig.json

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "@pcbjs/core",
    "strict": true,
    "noEmit": true
  }
}
```

## pcb.config.ts

```ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({
  entries: ['pcb.tsx'],        // required; relative to this file, globs such as 'boards/*.tsx' allowed
  outDir: '.pcbjs/dist',       // static site
  fabDir: '.pcbjs/fab',        // loose fab files
  base: '/',                   // URL path of the built site; absolute to prerender
  vite: {},                    // extra Vite options for the site
  repo: 'https://github.com/org/name', // optional, source links in a built site
  editor: { follow: 'click' }, // or 'meta-click', see editor.md
})
```

- Values shown are the defaults, `repo` aside.
- Looked up as `pcb.config.ts`, `.mts`, `.js`, `.mjs` in that order; `pcbjs.config.*` loads with a deprecation warning; `-c <file>` names another.
- `check`, `dev`, `build`, `preview`, `inspect` and `shot` read `entries` in order, globs sorted; entries on the command line win; with neither, the command fails naming `entries`.
- It runs once before any entry: the place for `defineDefaultBoard` and `defineDefaultRules`, see board.md.
- Recommended names: `pcb.tsx` for one board, `<board>.pcb.tsx` beside `<board>.sch.tsx` for several, as `blinky.pcb.tsx` in `examples/demo`.

## The template board

```tsx
// Hello: a green LED on a 20 x 15 mm two-layer board, powered from a two-pin header.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, LED0603, roundedRect } from '@pcbjs/lib'

const { GND, VCC, LED } = nets()

const J1 = PinHeader(2).source({ MPN: 'PEC02SAAN' }).connect(GND, VCC)
const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect(VCC, LED)
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED, K: GND })

export default (
  <PCB name="Hello" revision="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(20, 15, 1)} />
    <J1 at="3 4.96" />
    <R1 at="9 7.5" />
    <D1 at="15 7.5 180deg" />
    {route(J1[2]).Z(R1[1]).width(0.3)}
    {route(R1[2]).Z(D1.A).width(0.3)}
    {route(D1.K).X(J1[1]).width(0.3)}
    <text layer="F.SilkS" at="10 12" size={1}>Hello</text>
  </PCB>
)
```

- An entry default-exports `<PCB>`, a function returning it, or a promise of it, from a `.tsx` or `.ts` module.
- Order: header comment with the frame, imports with the fab preset first, `<PCB>` props no preset covers, `nets()`, one line per part, then outline on `Edge.Cuts`, placements, routes per net, pours, silk last.
- Outgrown a screen: nets and parts to `<board>.sch.ts`, part numbers to `<board>.sourcing.ts`, as `examples/demo` does.
