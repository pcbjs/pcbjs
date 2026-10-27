// Test helpers: the bounding box of a Gerber file and the hits of an Excellon drill file, enough to compare a KiCad fab
// set with a pcbjs one by bounding box and hole by hole, without a renderer.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
export const FOOTPRINTS = join(FIXTURES, 'footprints')

/** Every fixture footprint as [Lib:Name, path]. */
export function fixtureFootprints() {
  const out = []
  for (const lib of readdirSync(FOOTPRINTS).filter(d => d.endsWith('.pretty')).sort())
    for (const f of readdirSync(join(FOOTPRINTS, lib)).filter(f => f.endsWith('.kicad_mod')).sort())
      out.push([`${lib.replace(/\.pretty$/, '')}:${f.replace(/\.kicad_mod$/, '')}`, join(FOOTPRINTS, lib, f)])
  return out
}

/** The half extents of a macro whose primitives are plain numbers, such as KiCad's FreePoly: its outlines and circles. */
function macroExtent(body) {
  let hx = 0, hy = 0
  for (const prim of body.split('*').filter(x => x && !/^0($|[^.\d,])/.test(x))) {
    const v = prim.split(',').map(Number)
    if (v.some(n => !Number.isFinite(n))) return null
    if (v[0] === 1) { hx = Math.max(hx, Math.abs(v[3]) + v[2] / 2); hy = Math.max(hy, Math.abs(v[4]) + v[2] / 2) }
    else if (v[0] === 4) for (let i = 0; i <= v[2]; i++) { hx = Math.max(hx, Math.abs(v[3 + 2 * i])); hy = Math.max(hy, Math.abs(v[4 + 2 * i])) }
    else if (v[0] === 20) { const w = v[2] / 2; hx = Math.max(hx, Math.abs(v[3]) + w, Math.abs(v[5]) + w); hy = Math.max(hy, Math.abs(v[4]) + w, Math.abs(v[6]) + w) }
    else return null
  }
  return [hx, hy]
}

/** The half extents of an aperture along x and y, from its %AD definition and the macros. */
function apertureExtent(def, macros = new Map()) {
  const [name, args = ''] = def.split(',')
  const p = args.split('X').filter(Boolean).map(Number)
  if (name === 'C') return [p[0] / 2, p[0] / 2]
  if (name === 'R' || name === 'O') return [p[0] / 2, p[1] / 2]
  if (name === 'RoundRect') {
    const r = p[0], xs = [p[1], p[3], p[5], p[7]], ys = [p[2], p[4], p[6], p[8]]
    return [Math.max(...xs.map(Math.abs)) + r, Math.max(...ys.map(Math.abs)) + r]
  }
  const m = /^Outline(\d+)P$/.exec(name)
  if (m) {
    const n = Number(m[1]), rot = (p[2 * n] ?? 0) * Math.PI / 180
    let hx = 0, hy = 0
    for (let i = 0; i < n; i++) {
      const x = p[2 * i], y = p[2 * i + 1]
      hx = Math.max(hx, Math.abs(x * Math.cos(rot) - y * Math.sin(rot))); hy = Math.max(hy, Math.abs(x * Math.sin(rot) + y * Math.cos(rot)))
    }
    return [hx, hy]
  }
  if (macros.has(name)) return macroExtent(macros.get(name).replace(/\s+/g, '').replace(/\$(\d+)/g, (_m, i) => String(p[Number(i) - 1] ?? 0)))
  return null
}

/** The bounding box of everything a Gerber file draws, mm: { x0, y0, x1, y1 }, or null for an empty file. Throws on an aperture it cannot size. */
export function gerberBox(text) {
  const fs = /%FSLAX(\d)(\d)Y\d\d\*%/.exec(text)
  const dec = fs ? Number(fs[2]) : 6
  const ap = new Map()
  for (const m of text.matchAll(/%ADD(\d+)([^*]+)\*%/g)) ap.set(m[1], m[2])
  const macros = new Map()
  for (const m of text.matchAll(/%AM([A-Za-z_][\w.]*)\*([^%]*)%/g)) macros.set(m[1], m[2])
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (x, y, hx = 0, hy = 0) => { x0 = Math.min(x0, x - hx); x1 = Math.max(x1, x + hx); y0 = Math.min(y0, y - hy); y1 = Math.max(y1, y + hy) }
  let x = 0, y = 0, mode = 'G01', region = false, cur = null
  const body = text.replace(/%[^%]*%/g, '')
  for (const raw of body.split('*')) {
    const s = raw.trim()
    if (!s) continue
    if (s === 'G36') { region = true; continue }
    if (s === 'G37') { region = false; continue }
    const g = /^G0?([123])/.exec(s)
    if (g) mode = `G0${g[1]}`
    const d = /D(\d+)$/.exec(s)
    if (d && Number(d[1]) >= 10) {
      const def = ap.get(d[1])
      cur = def === undefined ? null : apertureExtent(def, macros)
      if (def !== undefined && !cur) throw new Error(`gerberBox: cannot size aperture ${def}`)
      continue
    }
    const num = (k) => { const m = new RegExp(`${k}(-?\\d+)`).exec(s); return m ? Number(m[1]) / 10 ** dec : undefined }
    const nx = num('X') ?? x, ny = num('Y') ?? y, op = /D0?([123])$/.exec(s)?.[1]
    if (!op) { x = nx; y = ny; continue }
    const [hx, hy] = region ? [0, 0] : cur ?? [0, 0]
    if (op === '3') add(nx, ny, hx, hy)
    else if (op === '1') {
      if (mode === 'G01') { add(x, y, hx, hy); add(nx, ny, hx, hy) }
      else {
        const cx = x + (num('I') ?? 0), cy = y + (num('J') ?? 0), r = Math.hypot(x - cx, y - cy)
        let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx)
        if (mode === 'G03' && a1 <= a0) a1 += 2 * Math.PI
        if (mode === 'G02' && a1 >= a0) a1 -= 2 * Math.PI
        for (let i = 0; i <= 64; i++) { const t = a0 + (a1 - a0) * i / 64; add(cx + r * Math.cos(t), cy + r * Math.sin(t), hx, hy) }
      }
    }
    x = nx; y = ny
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 }
}

/** The holes of an Excellon file as sorted strings "d@x,y", slots "d@x,y-x,y", rounded to the micrometre. */
export function drillHits(text) {
  const tools = new Map()
  for (const m of text.matchAll(/^T(\d+)C([\d.]+)/gm)) tools.set(Number(m[1]), Number(m[2]))
  const body = text.slice(text.search(/^%$/m) + 1)
  const r = v => (Math.round(v * 1000) / 1000).toFixed(3)
  let tool = 0
  const out = []
  for (const line of body.split('\n')) {
    const t = /^T(\d+)\s*$/.exec(line.trim())
    if (t) { tool = Number(t[1]); continue }
    const c = /^X(-?[\d.]+)Y(-?[\d.]+)(?:G85X(-?[\d.]+)Y(-?[\d.]+))?/.exec(line.trim())
    if (c) out.push(`${r(tools.get(tool))}@${r(+c[1])},${r(+c[2])}${c[3] !== undefined ? `-${r(+c[3])},${r(+c[4])}` : ''}`)
    const s = /^G00X(-?[\d.]+)Y(-?[\d.]+)/.exec(line.trim())
    if (s) out.push(`${r(tools.get(tool))}@${r(+s[1])},${r(+s[2])}`)
  }
  return out.sort()
}

/**
 * A small KiCad 10 board, as text, and its schematic, for the importer's fidelity: two copies of one footprint that differ only
 * in element order, the start of a closed outline, the BOM flag and the courtyard; a 1 mm track into a 0.6 mm pad; a header with
 * remove_unused_layers; an LED land with paste-only windows and pads with a paste margin and ratio; a filled ring on the silk
 * written after the disc inside it. The schematic gives the part numbers and marks D1 DNP.
 */
export function syntheticKicad() {
  const fx = (ref, at, body) => `  (footprint "Test:${body.name}" (layer "F.Cu") (at ${at})
    (property "Reference" "${ref}" (at 0 -2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "${body.value}" (at 0 2 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
    ${body.attr ?? '(attr smd)'}
${body.items.map(s => '    ' + s).join('\n')}
  )`
  const silk = (pts) => `(fp_poly (pts ${pts.map(p => `(xy ${p})`).join(' ')}) (stroke (width 0.12) (type solid)) (fill no) (layer "F.SilkS"))`
  const crt = (w) => `(fp_rect (start -${w} -0.8) (end ${w} 0.8) (stroke (width 0.05) (type solid)) (fill no) (layer "F.CrtYd"))`
  const rpad = (n, x, net) => `(pad "${n}" smd rect (at ${x} 0) (size 0.6 0.6) (layers "F.Cu" "F.Paste" "F.Mask") (net "${net}"))`
  const pcb = `(kicad_pcb (version 20260206) (generator "pcbnew") (generator_version "10.0")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal) (13 "F.Paste" user) (1 "F.Mask" user) (3 "B.Mask" user)
    (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen") (25 "Edge.Cuts" user) (31 "F.CrtYd" user "F.Courtyard") (35 "F.Fab" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "GND") (net 2 "SIG") (net 3 "VCC")
${fx('R1', '10 10', { name: 'R_Test', value: '10k', items: [rpad(1, -1, 'GND'), rpad(2, 1, 'SIG'), silk(['-1.5 -0.7', '1.5 -0.7', '1.5 0.7', '-1.5 0.7']), crt(1.6)] })}
${fx('R2', '10 20', { name: 'R_Test', value: '10k', attr: '(attr smd exclude_from_bom)', items: [crt(1.9), silk(['1.5 0.7', '-1.5 0.7', '-1.5 -0.7', '1.5 -0.7']), rpad(2, 1, 'SIG'), rpad(1, -1, 'GND')] })}
${fx('J1', '30 10', { name: 'Hdr_Test', value: 'Hdr', attr: '(attr through_hole)', items: [
  `(pad "1" thru_hole rect (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask") (remove_unused_layers yes) (keep_end_layers yes) (zone_layer_connections "In1.Cu") (net "GND"))`,
  `(pad "2" thru_hole circle (at 0 2.54) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask") (remove_unused_layers yes) (keep_end_layers yes) (zone_layer_connections) (net "SIG"))`,
  `(pad "3" thru_hole circle (at 0 5.08) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask") (remove_unused_layers no) (net "VCC"))`] })}
${fx('D1', '20 30', { name: 'LED_Test', value: 'LED', items: [
  `(pad "1" smd rect (at -1.2 0) (size 3.4 0.8) (layers "F.Cu" "F.Mask") (net "VCC"))`,
  `(pad "2" smd rect (at 2 0) (size 1.8 0.8) (layers "F.Cu" "F.Mask") (net "GND"))`,
  `(pad "" smd rect (at -0.6 0) (size 2.1 0.8) (layers "F.Paste"))`,
  `(pad "" smd rect (at 1.4 0) (size 0.6 0.8) (layers "F.Paste"))`,
  `(pad "3" smd rect (at 0 2) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (solder_paste_margin 0.05) (net "GND"))`,
  `(pad "4" smd rect (at 0 -2) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (solder_paste_margin -0.04) (solder_paste_margin_ratio -0.1) (net "GND"))`] })}
  (gr_rect (start 0 0) (end 45 40) (stroke (width 0.1) (type solid)) (fill no) (layer "Edge.Cuts"))
  (gr_circle (center 40 35) (end 40.4 35) (stroke (width 0) (type solid)) (fill yes) (layer "F.SilkS"))
  (gr_poly (pts (xy 38 33) (xy 42 33) (xy 42 37) (xy 38 37)) (stroke (width 0) (type solid)) (fill yes) (layer "F.SilkS"))
  (segment (start 11 10) (end 20 10) (width 1) (layer "F.Cu") (net "SIG"))
  (segment (start 20 10) (end 30 12.54) (width 1) (layer "F.Cu") (net "SIG"))
  (segment (start 11 20) (end 20 10) (width 1) (layer "F.Cu") (net "SIG"))
  (segment (start 30 12.54) (end 34 12.54) (width 0.3) (layer "In2.Cu") (net "SIG"))
)
`
  const sym = (ref, extra, flags = '(dnp no)') => `  (symbol (lib_id "Device:R") (at 0 0 0) (unit 1) (in_bom yes) (on_board yes) ${flags} (uuid "u-${ref}")
    (property "Reference" "${ref}" (at 0 0 0)) (property "Value" "x" (at 0 0 0)) (property "Footprint" "Test:x" (at 0 0 0)) (property "Datasheet" "" (at 0 0 0))
${extra.map(([k, v]) => `    (property "${k}" "${v}" (at 0 0 0))`).join('\n')}
    (instances (project "synth" (path "/root" (reference "${ref}") (unit 1)))))`
  const sch = `(kicad_sch (version 20260306) (generator "eeschema") (uuid "root")
  (lib_symbols (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (property "MPN" "LIBRARY DEFAULT" (at 0 0 0))))
${sym('R1', [['MPN', 'RC0603FR-0710KL'], ['Manufacturer', 'Yageo'], ['LCSC', 'C98220']])}
${sym('R2', [['MPN', 'RC0603FR-0710KL'], ['Manufacturer', 'Yageo'], ['LCSC', 'C98220']])}
${sym('J1', [['MPN', 'PZ254V-11-03P'], ['Assembly', 'hand']])}
${sym('D1', [['MPN', 'XL-4014UWC'], ['LCSC', 'C3646959']], '(dnp yes)')}
${sym('#PWR01', [['MPN', 'none']])}
)
`
  return { pcb, sch }
}
