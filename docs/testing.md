# Testing

Board tests: `*.test.ts` files that assert design intent against the compiled board, run by `pcbjs test` and `check --test`, and golden fab sets that catch any change to the copper.
Advanced. Read it to keep a rule the checks cannot know, such as a capacitor near its pin or a part on one side, as a test that fails when an edit breaks it.

```sh
pcbjs test                    # every *.test.ts under the project, and each golden/ folder
pcbjs test boards.test.ts     # the files given
pcbjs test --update           # write golden/<board>/ from the current fab set first
pcbjs check --test            # the checks, then the tests; exit 1 when either fails
```

## A test

A board test is a `node:test` file that reads the board with `board()` of `@pcbjs/cli/test` and asserts with the board API of queries.md. It never compiles: `pcbjs test` writes one snapshot, and every test reads it.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { board } from '@pcbjs/cli/test'

test('decoupling within 2 mm of U1', () => {
  const b = board('Blinky')
  for (const c of b.parts({ prefix: 'C' })) assert.ok(b.distance(c, 'U1/VDD').d <= 2, c.ref)
})

test('every LED on the front, and no error', () => {
  const b = board('Blinky')
  for (const d of b.parts({ prefix: 'D' })) assert.equal(d.side, 'F', d.ref)
  assert.deepEqual(b.findings({ severity: 'error' }), [])
})
```

- `board(name?, { target? })` returns the board by name, the only one without a name; `target` picks a target of a board with variants by name or slug, the first by default.
- `examples/demo/boards.test.ts` holds one test per demo board.
- Tests are TypeScript run by Node with no flag: `node --test --import @pcbjs/cli/test-register`, the register module stripping types with esbuild, so Node 22.12, the floor, runs them. Imports may leave out `.ts`. Output is Node's `spec` reporter.

## How a run works

- Every `*.test.ts`, `.test.mts` and `.test.tsx` under the project root counts, outside `node_modules`, `.pcbjs`, `.git` and `dist`; files named on the command line instead when given.
- The boards come from a live session's settled snapshot, including the unsaved text an editor holds, or from one compile here without a session or with `--fresh`. They are written to `.pcbjs/test/<snapshot>/<board>[-<target slug>].json`, older snapshots' folders removed, and `PCBJS_TEST_DIR` names the folder.
- An entry that fails to compile fails the run.

## Goldens

`pcbjs test --update` writes `golden/<board>[-<target slug>]/` from the snapshot's fab set: the Gerbers, the drill files and the IPC-D-356 netlist. Commit the folder. From then on one built-in test per folder, `golden <board>`, compares the current set with it:

- each Gerber by reading both back as the Gerber self check of fab-set.md does, failing when more than 0.01 mm² of copper or ink differs, and naming the file;
- each drill file by its holes, tool diameter and position;
- the netlist as net and pad pairs.

Dates, aperture numbers and file order never fail a golden; a track moved by a millimetre does. A golden for every board, and per target, is what makes a refactor of the code safe: run `pcbjs test`, and `--update` once a change to the copper is intended.

## Results

`pcbjs test` exits 0 when every test passed, 1 otherwise. `pcbjs test --json <file>` writes a `pcbjs.check/1` report of `command: 'test'`; `check --test --json <file>` adds the tests to the check's report, a failed test failing it:

```ts
interface Tests {
  status: 'ok' | 'fail' | 'skipped'
  passed: number
  failed: number
  ms: number
  results: { name: string; file: string | null; ok: boolean; ms: number; error?: string }[]
}
const empty: Tests = { status: 'skipped', passed: 0, failed: 0, ms: 0, results: [] }
```

## For agents

When asked to keep a property of the design, write it as a test beside the boards rather than a note: the next edit that breaks it fails `pcbjs check --test`, whoever makes it.

For a reviewed pin map or custom cable, compare the complete physical pad set against an independent manufacturer table and assert selected endpoint nets/polarity from independently reviewed literals. Keep deliberately unused, true NC and required unresolved pins distinct; repeated GND/NC names need not be unique. Inspect-derived global escape points also need a position/rotation/side guard, or a shared local frame that transforms the points with the part. The best-practices skill's electrical-intent reference contains the focused recipe.
