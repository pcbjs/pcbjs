# Measuring with inspect

Every number about a board comes from `pcbjs inspect`, never from reading `board.json` or the Gerbers by hand. One compile answers several queries; `--json` gives the same answers to a script.

## What to ask

| Question | Command |
| --- | --- |
| where a part and its pads are, in board mm | `pcbjs inspect U1`, `inspect part:U1` when a net has the same name |
| one pad | `pcbjs inspect U1.3` |
| a net: pads, tracks, vias, copper per layer, pour pieces, islands removed, stitching | `pcbjs inspect GND` |
| every route with length, target, group, skew, tuning, status | `pcbjs inspect --lengths`, or `--lengths DATA` for one net, pair or group |
| every item on a layer, with ink bounds and source | `pcbjs inspect --layer F.SilkS`, filtered by `U1` or a net |
| the board stack: mates, gaps, body heights by source | `pcbjs inspect references` |
| every ref and net name | `pcbjs inspect --json nothing`: an unknown query exits 1 and lists `refs` and `nets` |

- Name the entry first when the config lists several: `pcbjs inspect sense.tsx U1`.
- With `--lengths` or `--layer`, the other queries become filters, so ask for lengths and for nets in two calls.
- `--fresh` compiles here even when a dev server holds a current board.
- Coordinates come to 3 decimals; compare against another tool within 1 to 2 µm, not exactly.

## Contracts over inspect --json

A generator's placement asserts, an enclosure's walls or a spec's distances become a script that runs one inspect and prints every violation. It runs beside `pcbjs check`, from a make target or CI.

```js file=contracts.mjs
import { execFileSync } from 'node:child_process'

const REFS = ['J1', 'J2', 'U1', 'H1']
const run = args => JSON.parse(execFileSync('npx', ['pcbjs', 'inspect', ...args, '--json', '--fresh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
const { frame, results } = run(REFS.map(r => `part:${r}`).concat('net:GND'))
const part = Object.fromEntries(results.filter(r => r.footprint).map(r => [r.footprint.ref, r.footprint]))
const gnd = results.find(r => r.net)

function box(ref, kind) {
  const fp = part[ref]
  const layer = `${fp.side === 'B' ? 'B' : 'F'}.${kind}`
  const pts = fp.graphics.filter(g => g.layer === layer).flatMap(g => g.paths.flat())
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

const violations = []
const expect = (ok, what) => { if (!ok) violations.push(what) }

const [, right] = frame.outline.x
expect(Math.abs(box('J1', 'Fab').x1 - right - 1.0) < 0.01, 'J1 must stand 1.0 mm out of the right edge')
const hole = part.H1.pads[0].at
for (const v of gnd.vias) expect(Math.hypot(v.at[0] - hole[0], v.at[1] - hole[1]) > 3, `GND via at ${v.at} inside the H1 screw keep-out`)

console.log(`contracts  ${violations.length} violations`)
for (const v of violations) console.log(`  ${v}`)
process.exitCode = violations.length ? 1 : 0
```

- Read the shape of `frame` and each result once with `pcbjs inspect <query> --json` before writing the checks; the queries above give `footprint` with `pads`, `graphics` and `side`, and `net` with `pads`, `tracks`, `vias`, `copper` and `zones`.
- Footprint pads in the JSON carry no `ref`; add it when you flatten them.
- Share the numbers with whatever else uses them: import the constants module the board uses, so a contract and a placement never drift apart.
- Probe every contract: move a part 0.1 mm in a scratch edit that DRC passes and see exactly the expected violation.
- Check drawings per stroke segment, not by bounding box: an L-shaped bracket's box overlaps the body it frames.

## Measuring a change

- Copper of a net: the `copper` line of `inspect <net>`, per layer, drills cut out. Use it for heat copper and current paths.
- Pour fill: the `zone` rows, fill area, pieces and islands removed.
- Lengths: `inspect --lengths`, before and after, cold.
- Tightest margin of a rule: tighten the rule until it fires, see rules-as-drc.md.
- Stitching coverage: the `stitch` line, nearest neighbour 95th percentile.
- Silk and text placement: `inspect --layer F.SilkS --json`, strokes per text.

Report each change with its before and after numbers and the command that produced them.
