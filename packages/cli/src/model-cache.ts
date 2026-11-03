// pcbjs model cache ls|prune|path: the user-level cache of converted and fetched models.
import { cacheRows, cacheSize, pruneCache, userCacheDir, type CacheRow } from '@pcbjs/compile/internal/user-cache'

/** Bytes as kB or MB. */
export const sizeText = (n: number): string => (n < 1e6 ? `${(n / 1e3).toFixed(1)} kB` : `${(n / 1e6).toFixed(1)} MB`)

const day = (ms: number) => new Date(ms).toLocaleDateString('sv-SE')
// a 64 digit hash is shown by its first 12
const shortKey = (key: string) => key.replace(/[0-9a-f]{64}/, h => `${h.slice(0, 12)}…`)
const line = (r: CacheRow) => `${sizeText(r.size).padStart(9)}  ${day(r.used)}  ${shortKey(r.key)}  ${r.source}`
const total = (rows: CacheRow[]) => `${rows.length} file${rows.length === 1 ? '' : 's'}, ${sizeText(rows.reduce((a, r) => a + r.size, 0))}`

export interface ModelCacheOptions {
  older?: number
  maxSize?: number
  all?: boolean
  log?: (line: string) => void
}

/** One line of the directory and its size, for doctor. */
export function cacheSummary(): string {
  const dir = userCacheDir()
  return `${dir}, ${sizeText(cacheSize(dir))}`
}

export function modelCache(action: string, o: ModelCacheOptions = {}): number {
  const log = o.log ?? (l => console.log(l))
  const dir = userCacheDir()
  if (action === 'path') log(dir)
  else if (action === 'ls') {
    const rows = cacheRows(dir)
    log(`${dir}  ${total(rows)}`)
    for (const r of rows) log(line(r))
  } else if (action === 'prune') {
    const { removed, kept } = pruneCache({ older: o.older, maxSize: o.maxSize, all: o.all }, dir)
    for (const r of removed) log(`removed ${line(r)}`)
    log(`removed ${total(removed)}; ${total(kept)} kept in ${dir}`)
  } else throw new Error(`unknown model cache action: ${action}, use ls, prune or path`)
  return 0
}
