# Quick start

Install, make a project, and run the edit and check loop.
Read this first; every other topic file assumes it.

## Install

pcbjs needs Node 22.12 or newer. `@beta` is the npm tag until 0.1; `latest` holds a placeholder with no code, so name the tag:

```sh
npm install -D @pcbjs/pcbjs@beta
```

## A new project

```sh
npx pcbjs create my-board
cd my-board
npm install                                # the @pcbjs packages the template lists
npx pcbjs check                            # compile, DRC and ERC of the entries in pcb.config.ts
npm run dev                                # live viewer on http://localhost:5173
npm run build                              # fab set in .pcbjs/fab/my-board, site in .pcbjs/dist
```

`pcbjs create <dir>` copies the `board` template into a new or empty directory. It refuses a directory with files in it. The project gets:

- `pcb.tsx`, the board, shown below. `pcb.tsx` is the recommended entry of a project with one board.
- `pcb.config.ts`, the project config, with `entries: ['pcb.tsx']`.
- `package.json` with the `dev`, `build` and `preview` scripts, which take their entries from the config, and the @pcbjs packages at the dist-tag of the CLI that made it, `beta` during the beta, or `~0.1.0` style for a release.
- `tsconfig.json`, `.gitignore` and a short `README.md`.

The board and the package take the directory's name.

## From source

For contributors: clone https://github.com/pcbjs/pcbjs and run `npm install` and `npm run build` at its root. A project made under `examples/` with `npx pcbjs create` joins the workspace, and the root `npm install` links the @pcbjs packages into it. docs/development.md has the layout and the checks.

## tsconfig.json

JSX must point at @pcbjs/core:

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

The config sits in the project root, the directory the CLI runs in. The names tried are `pcb.config.ts`, `.mts`, `.js` and `.mjs`, in that order. The old name `pcbjs.config.*` still loads with a deprecation warning. `-c <file>` names any other file.

```ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({
  entries: ['pcb.tsx'],        // the boards, relative to this file; globs such as 'boards/*.tsx' allowed
  outDir: '.pcbjs/dist',       // static site
  fabDir: '.pcbjs/fab',        // loose fab files
  base: '/',                   // URL path of the built site; must be absolute to prerender
  vite: {},                    // extra Vite options for the site
  repo: 'https://github.com/org/name', // source links in a built site, optional
  editor: { follow: 'click' }, // 'click' or 'meta-click', see editor.md
})
```

`entries` lists the boards every command works on: `check`, `dev`, `build`, `preview`, `inspect` and `shot` read it, in list order, the matches of a glob sorted. Entries given on the command line win for that run and print one line saying so; with neither, a command fails and names `entries` and the config file. The other keys are optional and the values above are the defaults, `repo` aside. The config module runs once, before any entry. It is the place for `defineDefaultBoard` and `defineDefaultRules`, see board.md.

Naming an entry is recommended, never enforced: `pcb.tsx` for a single board, and `<board>.pcb.tsx` beside its `<board>.sch.tsx` schematic module when a project has several, such as `blinky.pcb.tsx` in `examples/demo`; any name works and nothing checks it, but editors, the file icons and readers recognise these.

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

An entry is a `.tsx` or `.ts` module that default-exports `<PCB>`, a function that returns it, or a promise of it.

## Where things go in a board file

1. A header comment: what the board is in one line, and its frame.
2. Imports, the fab preset first. The preset is the stackup, rules and sourcing in one line.
3. Board options no preset covers, as `<PCB>` props.
4. Nets, from `nets()`.
5. Parts, one line each: value, part numbers, connections in pin order.
6. The layout as the default export: the outline on `Edge.Cuts`, placements grouped with a comment each, routes per net, pours, silk last.

Comments say why a value is what it is, not what the code does. Once nets and parts outgrow a screen, move them to `<board>.sch.ts` and the part numbers to `<board>.sourcing.ts`, as `examples/demo` does for Blinky.

## The loop

1. Edit the board.
2. `npx pcbjs check`. It compiles, routes, runs DRC and ERC, and prints one line per board plus the findings. It writes no fab files and no site. `--watch` keeps it running and prints what changed.
3. Need a coordinate? `npx pcbjs inspect U1` prints the pads of U1 with their absolute centres and nets. With several entries, name the board first: `npx pcbjs inspect coin.pcb.tsx U1`.
4. When check says `ok`, `npx pcbjs build` writes the fab set and the site.

cli.md has every command and the output formats. routing.md and autorouter.md cover routing, the most common source of findings.
