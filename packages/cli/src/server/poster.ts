// The `?pcb:poster` SVGs: the board's top view and its schematic as pictures for a page, as small as they draw the same at any size a
// page shows them. docs/ui.md.

/** The layers of a board poster, its top view; the rest is for tools, not for a picture. */
const LAYERS = new Set(['B.Cu', 'F.Cu', 'F.SilkS', 'Edge.Cuts', 'holes'])

/** A number at 0.01 mm with no leading zero. */
const num = (n: number) => String(Math.round(n * 100) / 100).replace(/^(-?)0\./, '$1.')

/** Path data of absolute moves and lines as relative lines at 0.01 mm, a point within 0.1 mm of the last one dropped; any other data as it is. */
export function compactPath(d: string): string {
  if (!/^\s*M[MLZ\d.\s,-]*$/.test(d)) return d
  const out: string[] = []
  let at = [0, 0],
    start = [0, 0]
  for (const [, cmd, args] of d.matchAll(/([MLZ])([^MLZ]*)/g)) {
    if (cmd === 'Z') {
      out.push('z')
      at = start
      continue
    }
    const v = args
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    for (let i = 0; i + 1 < v.length; i += 2) {
      const p = [Math.round(v[i] * 100) / 100, Math.round(v[i + 1] * 100) / 100]
      if (cmd === 'M' && i === 0) {
        out.push(`M${num(p[0])} ${num(p[1])}`)
        at = start = p
        continue
      }
      const dx = p[0] - at[0],
        dy = p[1] - at[1]
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) continue
      out.push(`l${num(dx)} ${num(dy)}`)
      at = p
    }
  }
  return out.join('')
}

/** The command a command letter repeats when its numbers run on: a move goes on as a line. */
const after = (c: string) => (c === 'M' ? 'L' : c === 'm' ? 'l' : c)

/** Path data of moves, lines and closes written as tight as SVG reads it: a relative line along an axis as h or v, no repeated command, no separator a sign or a second point makes; any other data as it is. */
export function tightPath(d: string): string {
  if (!/^[MmLlHhVvZz\d.\s,-]*$/.test(d)) return d
  const segs: { c: string; n: string[] }[] = []
  for (const [, c, args] of d.matchAll(/([MmLlHhVvZz])([^MmLlHhVvZz]*)/g)) {
    const n = args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []
    const step = /[HhVv]/.test(c) ? 1 : /[Zz]/.test(c) ? 0 : 2
    if (!step) segs.push({ c, n: [] })
    for (let i = 0; step && i < n.length; i += step) segs.push({ c: i && step === 2 ? after(c) : c, n: n.slice(i, i + step) })
  }
  let out = ''
  let last = ''
  let prev: string | null = null
  for (const s of segs) {
    let { c, n } = s
    n = n.map(x => x.replace(/^(-?)0\.(?=\d)/, '$1.'))
    if (c === 'l' && Number(n[0]) === 0) [c, n] = ['v', [n[1]]]
    else if (c === 'l' && Number(n[1]) === 0) [c, n] = ['h', [n[0]]]
    if (c !== last || /[Zz]/.test(c)) {
      out += c
      prev = null
    }
    for (const x of n) {
      out += prev === null || x.startsWith('-') || (x.startsWith('.') && prev.includes('.')) ? x : ` ${x}`
      prev = x
    }
    last = after(c)
  }
  return out
}

/** A poster as a page draws it: the top view, no XML declaration, metadata, data or pcb: attributes, numbers at 0.01 mm. */
export const posterSvg = (svg: string): string =>
  svg
    .replace(/^<\?xml[^>]*>\n/, '')
    .replace(/\s*<metadata>[\s\S]*?<\/metadata>/, '')
    .replace(/\s*<g pcb:layer="([^"]+)"[^>]*>[\s\S]*?<\/g>/g, (g, id: string) => (LAYERS.has(id) ? g : ''))
    .replace(/ d="([^"]*)"/g, (_, d: string) => ` d="${tightPath(compactPath(d))}"`)
    .replace(/ (?:data-[a-z-]+|pcb:[a-z]+|xmlns:pcb)="[^"]*"/g, '')
    .replace(/-?\d+\.\d{3,}/g, n => String(Math.round(Number(n) * 100) / 100))
