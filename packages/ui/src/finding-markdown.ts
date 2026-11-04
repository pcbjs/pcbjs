import { diagnosticLabel as label, diagnosticUnit as unit, findingEvidence } from './finding-format'
import type { SiteFinding } from '@pcbjs/core/site-data'

type Finding = SiteFinding
const plain = (value: unknown) => String(value).replace(/\s+/g, ' ')
const escape = (value: unknown) =>
  plain(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]#|~]/g, '\\$&')
const code = (value: unknown) => {
  const text = plain(value)
  const fence = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length)) + 1)
  const pad = /^[` ]|[` ]$/.test(text) ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}
const quantity = (value: { value: number; unit: string }) => `${value.value} ${escape(unit(value.unit))}`

/** Keep optional diagnostic fields nested and readable without losing checker evidence. */
function details(value: unknown, depth = 0): string {
  if (value === null || typeof value !== 'object') return `${escape(value)}\n`
  if ('value' in value && 'unit' in value && typeof value.value === 'number' && typeof value.unit === 'string') return `${quantity(value as { value: number; unit: string })}\n`
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i + 1), v] as const) : Object.entries(value)
  if (!entries.length) return 'None\n'
  return '\n' + entries.map(([key, v]) => `${'  '.repeat(depth)}- **${escape(label(key))}:** ${details(v, depth + 1)}`).join('')
}

function geometry(witness: NonNullable<Finding['witness']>): string {
  let text = '\n## Geometry\n\n'
  if (witness.layer) text += `- **Layer:** ${code(witness.layer)}\n\n`
  const points = (title: string, rows: [number, number][]) =>
    `### ${title}\n\n| Point | X (mm) | Y (mm) |\n| --- | --- | --- |\n${rows.map((p, i) => `| ${i + 1} | ${p[0]} | ${p[1]} |\n`).join('')}\n`
  if (witness.points?.length) text += points('Points', witness.points)
  if (witness.segments?.length) {
    text += '### Segments\n\n| Segment | From X (mm) | From Y (mm) | To X (mm) | To Y (mm) |\n| --- | --- | --- | --- | --- |\n'
    witness.segments.forEach(([a, b], i) => {
      text += `| ${i + 1} | ${a[0]} | ${a[1]} | ${b[0]} | ${b[1]} |\n`
    })
    text += '\n'
  }
  witness.rings?.forEach((ring, i) => {
    text += points(`Overlap boundary ${i + 1}`, ring)
  })
  return text
}

export function findingText(f: Finding, board?: string): string {
  const { id, rule, severity, message, refs, at, layer, measured, required, provenance, src, witness, args, fingerprint, items, ...extra } = f
  let text = `# ${escape(label(rule))}\n\n**${escape(label(severity))}**${board ? ` · Board ${code(board)}` : ''}\n\n${escape(message)}\n`
  if (measured || required) {
    text += '\n## Measurements\n\n| Check | Value |\n| --- | --- |\n'
    if (measured) text += `| Measured | ${quantity(measured)} |\n`
    if (required) text += `| Required | ${quantity(required)} |\n`
  }
  if (at || layer) {
    text += '\n## Location\n\n'
    if (layer) text += `- **Layer:** ${code(layer)}\n`
    if (at) text += `- **Position:** X ${at[0]} mm, Y ${at[1]} mm\n`
  }
  text += '\n## Affected entities\n\n'
  if (refs.length) {
    for (const ref of refs) {
      text += '- '
      text += code(ref)
      text += '\n'
    }
  } else text += 'No selectable entities.\n'
  if (witness) text += geometry(witness)
  for (const { title, value, note } of findingEvidence(f)) text += `\n## ${title}\n${note ? `\n${note}\n` : ''}${details(value)}\n`
  text += `\n## Diagnostic identity\n\n- **Rule:** ${code(rule)}\n- **Finding:** ${code(id)}\n`
  if (fingerprint) text += `- **Fingerprint:** ${code(fingerprint)}\n`
  if (items?.length) text += `- **Item IDs:** ${items.map(code).join(', ')}\n`
  return text
}
