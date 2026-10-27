// Writes src/brand-data.ts, the silk polygons of <Brand>, from site/brand/mark-mono.svg and wordmark-mono.svg.
// Run from the repo root: node packages/lib/scripts/brand.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const C = createRequire(import.meta.url)(resolve(root, 'node_modules/clipper-lib'))
const svg = f => readFileSync(resolve(root, 'site/brand', f), 'utf8')

// clipper works in integers: 1000 per wordmark unit, the mark's 512 grid scaled into 96
const S = 1000, MARK = 96 / 512
// chord error of flattened curves, in wordmark units
const TOL = 0.04

const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
const toInt = (pts, k) => pts.map(([x, y]) => ({ X: Math.round(x * k * S), Y: Math.round(y * k * S) }))

function arc(cx, cy, r, a0, a1, k) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (2 * Math.acos(Math.max(-1, 1 - TOL / (r * k))))))
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] })
}

function roundRect(x, y, w, h, r, k) {
  if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
  const q = Math.PI / 2
  return [...arc(x + w - r, y + r, r, -q, 0, k), ...arc(x + w - r, y + h - r, r, 0, q, k), ...arc(x + r, y + h - r, r, q, 2 * q, k), ...arc(x + r, y + r, r, 2 * q, 3 * q, k)]
}

/** Absolute M L H V Q C Z path data as closed rings, curves flattened to TOL. */
function rings(d) {
  const out = []
  let ring = null, x = 0, y = 0
  const toks = d.match(/[MLHVQCZ]|-?[\d.]+(?:e-?\d+)?/gi)
  let i = 0, cmd = ''
  const num = () => Number(toks[i++])
  const curve = (pts) => {
    const len = pts.slice(1).reduce((s, p, j) => s + Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]), 0)
    const n = Math.max(1, Math.ceil(Math.sqrt(len / TOL) / 2))
    for (let s = 1; s <= n; s++) {
      const t = s / n
      let ps = pts
      while (ps.length > 1) ps = ps.slice(1).map((p, j) => [ps[j][0] + (p[0] - ps[j][0]) * t, ps[j][1] + (p[1] - ps[j][1]) * t])
      ring.push(ps[0])
    }
  }
  while (i < toks.length) {
    if (/[A-Z]/i.test(toks[i])) cmd = toks[i++]
    if (cmd === 'M') { ring = [[x = num(), y = num()]]; out.push(ring); cmd = 'L' }
    else if (cmd === 'L') ring.push([x = num(), y = num()])
    else if (cmd === 'H') ring.push([x = num(), y])
    else if (cmd === 'V') ring.push([x, y = num()])
    else if (cmd === 'Q') { const c = [num(), num()], e = [num(), num()]; curve([[x, y], c, e]);[x, y] = e }
    else if (cmd === 'C') { const c1 = [num(), num()], c2 = [num(), num()], e = [num(), num()]; curve([[x, y], c1, c2, e]);[x, y] = e }
    else if (cmd === 'Z') { cmd = '' }
    else throw new Error(`unsupported path command ${cmd} in ${d.slice(0, 40)}`)
  }
  return out
}

function union(paths) {
  const c = new C.Clipper(), sol = new C.Paths()
  c.AddPaths(paths, C.PolyType.ptSubject, true)
  c.Execute(C.ClipType.ctUnion, sol, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero)
  return sol
}
function stroke(paths, w, closed) {
  const o = new C.ClipperOffset(2, TOL * S), sol = new C.Paths()
  o.AddPaths(paths, C.JoinType.jtRound, closed ? C.EndType.etClosedLine : C.EndType.etOpenRound)
  o.Execute(sol, w / 2 * S)
  return sol
}

// the mark, from mark-mono.svg in its 512 grid
const mono = svg('mark-mono.svg')
const mark = []
for (const tag of mono.match(/<rect [^>]*>/g)) {
  const a = attrs(tag), x = +a.x, y = +a.y, w = +a.width, h = +a.height, r = +(a.rx ?? 0)
  if (a.fill === 'none') {
    const t = +a['stroke-width'] / 2
    mark.push(toInt(roundRect(x - t, y - t, w + 2 * t, h + 2 * t, r + t, MARK), MARK), toInt(roundRect(x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0, r - t), MARK), MARK).reverse())
  } else mark.push(toInt(roundRect(x, y, w, h, r, MARK), MARK))
}
const body = union(mark.filter((_, i) => i > 1))
const ring = new C.Paths(); { const c = new C.Clipper(); c.AddPath(mark[0], C.PolyType.ptSubject, true); c.AddPath(mark[1], C.PolyType.ptClip, true); c.Execute(C.ClipType.ctDifference, ring) }
for (const tag of mono.match(/<path [^>]*>/g)) {
  const a = attrs(tag)
  body.push(...stroke(rings(a.d).map(r => toInt(r, MARK)), +a['stroke-width'] * MARK, false))
}
const markPolys = union([...ring, ...body])

// the letters, from wordmark-mono.svg in wordmark units
const word = svg('wordmark-mono.svg')
const [pcbTag, jsTag] = word.match(/<path d="[^"]*"[^>]*>/g).slice(-2).map(attrs)
const pcb = union(rings(pcbTag.d).map(r => toInt(r, 1)))
const js = rings(jsTag.d).map(r => toInt(r, 1))
const jsWidth = +jsTag['stroke-width']

const clean = ps => C.Clipper.CleanPolygons(ps, TOL * S / 4)
const enc = ps => ps.map(p => p.map(q => `${Math.round(q.X / 10)},${Math.round(q.Y / 10)}`).join(' '))
const box = ps => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of ps) for (const q of p) { b[0] = Math.min(b[0], q.X / S); b[1] = Math.min(b[1], q.Y / S); b[2] = Math.max(b[2], q.X / S); b[3] = Math.max(b[3], q.Y / S) } return b.map(v => Math.round(v * 100) / 100) }
const jsInk = stroke(js, jsWidth, true)
const markBox = box(markPolys), wordBox = box([...pcb, ...jsInk])
const thin = Number(/stroke-width="(\d+)"/.exec(mono)[1]) * MARK

writeFileSync(resolve(here, '../src/brand-data.ts'), `// Generated by scripts/brand.mjs from site/brand/mark-mono.svg and wordmark-mono.svg; do not edit.
// Rings are "x,y x,y …" in hundredths of a wordmark unit: the mark is 96 units high, y down.

/** Filled rings of the mark, outers and holes, none overlapping. */
export const MARK = ${JSON.stringify(enc(clean(markPolys)))}
/** Filled rings of the letters pcb. */
export const PCB = ${JSON.stringify(enc(clean(pcb)))}
/** Glyph edges of the letters js, drawn as outlines JS_WIDTH wide. */
export const JS = ${JSON.stringify(enc(clean(js)))}
export const JS_WIDTH = ${jsWidth}
/** The thinnest filled stroke of the mark, the body outline. */
export const MARK_THIN = ${thin}
/** Ink boxes [x0, y0, x1, y1] in wordmark units, the js outline included. */
export const MARK_BOX = ${JSON.stringify(markBox)}
export const WORD_BOX = ${JSON.stringify(wordBox)}
`)
console.log('brand-data.ts:', { mark: markPolys.length, pcb: pcb.length, js: js.length, markBox, wordBox, thin })
