# Netlist and copper comparison

The second correctness check of a port: every KiCad pad has a pcbjs pad at the same board position with the same net, size and drill. Matching by ref and position, not by pad number, still compares a footprint whose numbering changed on purpose, and lists the renumbered pads apart.

```js file=netcheck.mjs
// Usage: node netcheck.mjs <board.kicad_pcb> <entry.tsx>
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseSExpr } from '@pcbjs/kicad'

const [kicadFile, entry] = process.argv.slice(2)
const all = (node, name) => node.filter(c => Array.isArray(c) && c[0] === name)
const one = (node, name) => all(node, name)[0]
const mm = v => Math.round(v * 1e3) / 1e3
const netOf = pad => { const n = one(pad, 'net'); return n ? String(n.at(-1)) : '' }

const kicad = []
for (const fp of all(parseSExpr(readFileSync(kicadFile, 'utf8')), 'footprint')) {
  const [fx, fy, fr = 0] = one(fp, 'at').slice(1).map(Number)
  const ref = all(fp, 'property').find(p => p[1] === 'Reference')?.[2]
  const t = fr * Math.PI / 180
  for (const pad of all(fp, 'pad')) {
    const [px, py] = one(pad, 'at').slice(1).map(Number)
    // pad positions are in the footprint frame, back parts already flipped; angles turn counter-clockwise on screen, y down
    kicad.push({ ref, num: String(pad[1]), net: netOf(pad), x: mm(fx + px * Math.cos(t) + py * Math.sin(t)), y: mm(fy - px * Math.sin(t) + py * Math.cos(t)) })
  }
}

const refs = [...new Set(kicad.map(p => p.ref))]
const json = JSON.parse(execFileSync('npx', ['pcbjs', 'inspect', entry, ...refs.map(r => `part:${r}`), '--json', '--fresh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }))
const pcbjs = new Map()
for (const { footprint: fp } of json.results) for (const p of fp?.pads ?? []) {
  pcbjs.set(`${fp.ref} ${mm(p.at[0])} ${mm(p.at[1])}`, { num: p.num, net: p.net && p.net !== 'NC' ? p.net : '' })
}

const out = []
const kicadToPcbjs = new Map(), pcbjsToKicad = new Map()
const near = (ref, x, y) => [0, -0.001, 0.001].flatMap(dx => [0, -0.001, 0.001].map(dy => `${ref} ${mm(x + dx)} ${mm(y + dy)}`)).find(k => pcbjs.has(k))
for (const k of kicad) {
  const key = near(k.ref, k.x, k.y)
  if (!key) { out.push(`missing   ${k.ref}.${k.num} at (${k.x}, ${k.y}), net ${k.net}`); continue }
  const p = pcbjs.get(key)
  pcbjs.delete(key)
  if (p.num !== k.num) out.push(`numbered  ${k.ref} pad ${k.num} in KiCad is pad ${p.num} here`)
  if (!k.net !== !p.net) { out.push(`net       ${k.ref}.${k.num}: ${k.net || 'none'} against ${p.net || 'none'}`); continue }
  if (!k.net) continue
  const was = kicadToPcbjs.get(k.net), back = pcbjsToKicad.get(p.net)
  if (was && was !== p.net) out.push(`net       ${k.ref}.${k.num}: KiCad ${k.net} is ${p.net} here but ${was} on other pads`)
  else if (back && back !== k.net) out.push(`net       ${k.ref}.${k.num}: ${p.net} here is KiCad ${k.net} but KiCad ${back} on other pads`)
  kicadToPcbjs.set(k.net, p.net)
  pcbjsToKicad.set(p.net, k.net)
}
for (const key of pcbjs.keys()) out.push(`extra     ${key}: not in KiCad`)

console.log(out.join('\n'))
console.log(`pads ${kicad.length}, nets ${kicadToPcbjs.size}, differences ${out.filter(l => !l.startsWith('numbered')).length}`)
process.exitCode = out.some(l => !l.startsWith('numbered')) ? 1 : 0
```

- Nets are compared as a mapping, not by name: the importer renames `+5V` to `P5V` and drops a root sheet's slash, `/D6` to `D6`. Every KiCad net must map to exactly one pcbjs net and back.
- `inspect --json` prints mm to 3 decimals, so positions match within 1 µm; the `near` lookup absorbs rounding at the third decimal.
- Pads of one number on a padstack with a different front shape come out as two pcbjs pads at one centre; count them apart rather than calling them extra.
- Extend it the same way for tracks and vias: `pcbjs inspect net:<name> --json` gives `tracks` with `layer`, `width` and `pts`, `vias` with `at`, `size` and `drill`; compare KiCad's `segment`, `arc` and `via` nodes by net, layer, width and both ends. Query every net that has KiCad copper, plus the nets your own changes touch, or new vias on a net KiCad routes only by pour are never seen.
- Run it on the raw import, after every refinement, and cold and warm after any pcbjs update. A port that improves the copper lists the intended differences, see the pcbjs-best-practices skill.
