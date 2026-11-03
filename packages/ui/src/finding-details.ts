import { diagnosticLabel as label, diagnosticUnit as unit, findingEvidence } from './finding-format'
import type { SiteFinding } from '@pcbjs/core/site-data'

const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const code = (value: unknown): string => `<code>${esc(value)}</code>`

function detail(value: unknown): string {
  if (value === null) return '<span class="muted">None</span>'
  if (typeof value !== 'object') return esc(value)
  if ('value' in value && 'unit' in value && typeof value.value === 'number' && typeof value.unit === 'string') return `${esc(value.value)} ${esc(unit(value.unit))}`
  if (Array.isArray(value)) return value.length ? `<ol>${value.map(v => `<li>${detail(v)}</li>`).join('')}</ol>` : '<span class="muted">None</span>'
  const entries = Object.entries(value)
  return entries.length ? `<dl>${entries.map(([k, v]) => `<dt>${esc(label(k))}</dt><dd>${detail(v)}</dd>`).join('')}</dl>` : '<span class="muted">None</span>'
}
const section = (title: string, body: string): string => `<section><h2>${esc(title)}</h2>${body}</section>`
const rows = (values: [string, string][]): string => `<dl>${values.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${value}</dd>`).join('')}</dl>`
const table = (heads: string[], values: unknown[][]): string => `<div class="table"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${values.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`

export function findingDetails(p: { board: string; finding: SiteFinding | null }): string {
  const f = p.finding
  if (!f) return '<p class="muted">No finding is focused.</p>'
  const { id, rule, severity, message, refs, at, layer, measured, required, provenance, src, witness, args, fingerprint, items, ...extra } = f
  let html = `<header><div class="eyebrow"><span class="severity ${esc(severity)}">${esc(label(severity))}</span><span>${esc(p.board)}</span></div><h1>${esc(label(rule))}</h1><p class="message">${esc(message)}</p></header>`
  if (measured || required) html += section('Measurements', `<div class="measurements">${[['Measured', measured], ['Required', required]].flatMap(([title, q]) => q && typeof q === 'object' ? [`<div><span>${title}</span><strong>${detail(q)}</strong></div>`] : []).join('')}</div>`)
  if (at || layer) html += section('Location', rows([...(layer ? [['Layer', code(layer)] as [string, string]] : []), ...(at ? [['Position', `X ${esc(at[0])} mm · Y ${esc(at[1])} mm`] as [string, string]] : [])]))
  html += section('Affected entities', refs.length ? `<p class="muted">Click to highlight. Ctrl or Command adds or removes an entity. Select text across references to highlight several.</p><div class="entities">${[...new Set(refs)].map(ref => `<button type="button" class="entity" data-ref="${esc(ref)}" aria-pressed="false">${code(ref)}</button>`).join('')}</div>` : '<p class="muted">No selectable entities.</p>')
  if (witness) {
    let geometry = witness.layer ? rows([['Layer', code(witness.layer)]]) : ''
    const points = (values: number[][]): string => table(['Point', 'X (mm)', 'Y (mm)'], values.map((pt, i) => [i + 1, ...pt]))
    if (witness.points?.length) geometry += '<h3>Points</h3>' + points(witness.points)
    if (witness.segments?.length) geometry += '<h3>Segments</h3>' + table(['Segment', 'From X (mm)', 'From Y (mm)', 'To X (mm)', 'To Y (mm)'], witness.segments.map(([a, b], i) => [i + 1, ...a, ...b]))
    witness.rings?.forEach((ring, i) => { geometry += `<h3>Overlap boundary ${i + 1}</h3>` + points(ring) })
    html += section('Geometry', geometry || '<p class="muted">No geometry supplied.</p>')
  }
  for (const { title, value, note } of findingEvidence(f)) html += section(title, (note ? `<p class="muted">${esc(note)}</p>` : '') + detail(value))
  html += section('Diagnostic identity', rows([['Rule', code(rule)], ['Finding', code(id)], ...(fingerprint ? [['Fingerprint', code(fingerprint)] as [string, string]] : []), ...(items?.length ? [['Item IDs', items.map(code).join(', ')] as [string, string]] : [])]))
  return html
}

