import type { SiteFinding } from '@pcbjs/core/site-data'

export const diagnosticLabel = (key: string): string => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase())
export const diagnosticUnit = (value: string): string => ({ mm2: 'mm²', deg: '°', ohm: 'Ω' })[value] ?? value

/** Optional evidence sections shared by the HTML and Markdown presentations. */
export function findingEvidence(f: SiteFinding): { title: string; value: unknown; note?: string }[] {
  const { id, rule, severity, message, refs, at, layer, measured, required, provenance, src, witness, args, fingerprint, items, ...extra } = f
  const { layer: witnessLayer, points, segments, rings, ...geometry } = witness ?? {}
  return [
    ...(provenance !== undefined ? [{ title: 'Rule provenance', value: provenance, note: 'Highest priority first.' }] : []),
    ...(src !== undefined ? [{ title: 'Source', value: src }] : []),
    ...(Object.keys(geometry).length ? [{ title: 'Other geometry fields', value: geometry }] : []),
    ...(args !== undefined ? [{ title: 'Additional details', value: args }] : []),
    ...(Object.keys(extra).length ? [{ title: 'Other diagnostic fields', value: extra }] : []),
  ]
}
