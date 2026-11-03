// Which part number a BOM row orders: the first tag the part has an `MPN:<tag>` for, else `MPN`; keys and tags as written.
import type { Sourcing } from './site-data.js'

/** The tag of a sourcing key: "" for `MPN`, "US" for `MPN:US`, null for any other key. */
export function mpnTag(key: string): string | null {
  const m = /^MPN(?::(.+))?$/.exec(key)
  return m ? (m[1] ?? '').trim() : null
}

/** True for `MPN` and `MPN:<tag>` keys. */
export const isMpnKey = (key: string): boolean => mpnTag(key) !== null

/** Resolve a row's sourcing for an ordered tag list; `tag` as the list spells it, "" for the catch-all, null when nothing matched. */
export function resolveSourcing(fields: Record<string, string>, tags: readonly string[]): Sourcing {
  const all: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (isMpnKey(k) && v !== '') all[k] = v
  const tagged = new Map<string, string>()
  let catchAll: string | undefined
  for (const [k, v] of Object.entries(all)) {
    const t = mpnTag(k)!
    if (t === '') catchAll ??= v
    else if (!tagged.has(t)) tagged.set(t, v)
  }
  let mpn: string | null = null,
    tag: string | null = null
  for (const t of tags) {
    const v = tagged.get(t)
    if (v !== undefined) {
      mpn = v
      tag = t
      break
    }
  }
  if (mpn === null && catchAll !== undefined) {
    mpn = catchAll
    tag = ''
  }
  const out: Sourcing = { mpn, tag, all }
  const manufacturer = fields.Manufacturer,
    datasheet = fields.Datasheet
  if (manufacturer) out.manufacturer = manufacturer
  if (datasheet) out.datasheet = datasheet
  return out
}
