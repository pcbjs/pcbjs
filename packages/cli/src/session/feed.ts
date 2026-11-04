// What becomes an event: store syncs and watcher writes coalesced per file over 200 ms, saves, claims of agents' own writes, and the cursor and
// selection kept at their last value per 500 ms. docs/queries.md has the rules.
import { resolve } from 'node:path'
import { sourcePath } from '../project/files.js'
import { createHash } from 'node:crypto'
import type { By, EventData } from '@pcbjs/core/protocol'
import { changedRanges, type EventLog } from './events.js'

/** ms an edit of one file is coalesced over */
export const COALESCE_MS = 200
/** ms a claim and the watcher's event of one file are matched within */
export const CLAIM_MS = 2000
/** ms after the last claim in which unclaimed writes wait for theirs */
export const CLAIMING_MS = 600_000
/** ms a save keeps the watcher's event of its own write from being an edit */
export const SAVE_MS = 5000
/** ms the cursor and the selection keep their last value over */
export const THROTTLE_MS = 500

export interface FeedOptions {
  log(): EventLog | undefined
  /** the project root holding a real path, null outside every project */
  projectOf(file: string): string | null
  /** the file on disk, null when it is gone */
  disk(file: string): string | null
}

export interface Feed {
  /** a connection's sync reached the store; `text` null when the file went back to disk */
  synced(file: string, text: string | null, by: By | null, source: 'editor' | 'agent'): void
  /** the watcher saw a write */
  written(file: string): void
  saved(file: string, by: By | null): void
  /** `session/edited`: an agent wrote the file with its own tools */
  claim(file: string, by: By): void
  /** a harness hook will claim its writes from now on, as its first turn says */
  expectClaims(): void
  /** a write under an editor's text: `push` gets its claimant, waiting for the claim as `written` does */
  shadowed(file: string, push: (by: By | null) => void): void
  cursor(file: string, line: number, col: number, by: By | null): void
  selection(project: string, sel: EventData['selection'], by: By | null): void
  /** every edit waiting goes now, as a compile's events must follow the edits it compiled */
  flush(): void
  dispose(): void
}

const hash = (t: string | null) => (t === null ? '' : createHash('sha1').update(t).digest('hex'))

export function eventFeed(o: FeedOptions): Feed {
  const timers = new Set<NodeJS.Timeout>()
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
    return t
  }
  const rel = (project: string, file: string) => sourcePath(project, file)
  // the text each file had before its burst of syncs began, and the last one synced
  const synced = new Map<string, { before: string; text: string; by: By | null; source: 'editor' | 'agent'; timer: NodeJS.Timeout }>()
  const last = new Map<string, string>()
  const saves = new Map<string, { hash: string; at: number }>()
  const claims = new Map<string, { by: By; at: number }>()
  const disk = new Map<string, { timer: NodeJS.Timeout; at: number }>()
  const shadows = new Map<string, { push: (by: By | null) => void; timer: NodeJS.Timeout }>()
  const take = (file: string): By | null => {
    const c = claims.get(file)
    if (!c || Date.now() - c.at >= CLAIM_MS) return null
    claims.delete(file)
    return c.by
  }
  let claimed = -Infinity

  const flushSync = (file: string) => {
    const s = synced.get(file)
    synced.delete(file)
    const project = o.projectOf(file)
    if (!s || !project) return
    last.set(file, s.text)
    const ranges = changedRanges(s.before, s.text)
    // a session write through the editor arrives as the editor's sync; its claim names the agent
    const c = claims.get(file)
    const claimed = c && Date.now() - c.at < CLAIM_MS ? c : null
    if (claimed) claims.delete(file)
    if (ranges.length) o.log()?.push('edit', project, { file: rel(project, file), source: claimed ? 'agent' : s.source, ranges }, claimed?.by ?? s.by)
  }
  const flushDisk = (file: string) => {
    disk.delete(file)
    const project = o.projectOf(file)
    if (!project) return
    const text = o.disk(file)
    const save = saves.get(file)
    if (save && Date.now() - save.at < SAVE_MS && save.hash === hash(text)) return
    const c = claims.get(file)
    const claimed = c && Date.now() - c.at < CLAIM_MS ? c : null
    if (claimed) claims.delete(file)
    if (text !== null) last.set(file, text)
    o.log()?.push('edit', project, { file: rel(project, file), source: claimed ? 'agent' : 'disk', ranges: null }, claimed?.by ?? null)
  }
  // while agents claim their writes, an unclaimed write waits for its claim up to 2 s after the watcher saw it
  const claimWait = (file: string, at: number) => {
    return claims.has(file) || Date.now() - claimed > CLAIMING_MS ? 0 : Math.max(0, at + CLAIM_MS - Date.now())
  }
  // the first value goes at once, the last of each 500 ms after it
  const throttled = new Map<string, { pending: (() => void) | null }>()
  const throttle = (key: string, push: () => void) => {
    const t = throttled.get(key)
    if (t) {
      t.pending = push
      return
    }
    push()
    const entry: { pending: (() => void) | null } = { pending: null }
    throttled.set(key, entry)
    later(THROTTLE_MS, () => {
      throttled.delete(key)
      if (entry.pending) throttle(key, entry.pending)
    })
  }

  return {
    synced(file, text, by, source) {
      file = resolve(file)
      if (!o.projectOf(file)) return
      const now = text ?? o.disk(file) ?? ''
      const s = synced.get(file)
      if (s) {
        clearTimeout(s.timer)
        timers.delete(s.timer)
        s.text = now
        s.by = by
        s.source = source
        s.timer = later(COALESCE_MS, () => flushSync(file))
        return
      }
      const before = last.get(file) ?? o.disk(file) ?? ''
      synced.set(file, { before, text: now, by, source, timer: later(COALESCE_MS, () => flushSync(file)) })
    },
    written(file) {
      file = resolve(file)
      if (!o.projectOf(file) || /[\\/](?:\.pcbjs|node_modules)[\\/]/.test(file)) return
      const d = disk.get(file)
      if (d) {
        clearTimeout(d.timer)
        timers.delete(d.timer)
      }
      const at = d?.at ?? Date.now()
      const t = later(COALESCE_MS, () => {
        const ms = claimWait(file, at)
        if (!ms) return flushDisk(file)
        disk.set(file, { at, timer: later(ms, () => flushDisk(file)) })
      })
      disk.set(file, { timer: t, at })
    },
    saved(file, by) {
      file = resolve(file)
      const project = o.projectOf(file)
      if (!project) return
      saves.set(file, { hash: hash(o.disk(file)), at: Date.now() })
      o.log()?.push('save', project, { file: rel(project, file) }, by)
    },
    claim(file, by) {
      file = resolve(file)
      claimed = Date.now()
      claims.set(file, { by, at: claimed })
      const sh = shadows.get(file)
      if (sh) {
        clearTimeout(sh.timer)
        timers.delete(sh.timer)
        shadows.delete(file)
        sh.push(take(file))
      }
      const d = disk.get(file)
      // the write is waiting past its coalescing: it goes now, attributed
      if (d && Date.now() - d.at >= COALESCE_MS) {
        clearTimeout(d.timer)
        timers.delete(d.timer)
        flushDisk(file)
      }
    },
    expectClaims() {
      claimed = Date.now()
    },
    shadowed(file, push) {
      file = resolve(file)
      const by = take(file)
      if (by || Date.now() - claimed > CLAIMING_MS) return push(by)
      const timer = later(CLAIM_MS, () => {
        shadows.delete(file)
        push(take(file))
      })
      shadows.set(file, { push, timer })
    },
    cursor(file, line, col, by) {
      file = resolve(file)
      const project = o.projectOf(file)
      if (!project) return
      throttle(`cursor|${by?.client ?? ''}`, () => o.log()?.push('cursor', project, { file: rel(project, file), line, col }, by))
    },
    selection(project, sel, by) {
      throttle(`selection|${by?.client ?? ''}`, () => o.log()?.push('selection', project, sel, by))
    },
    flush() {
      for (const [file, s] of [...synced]) {
        clearTimeout(s.timer)
        timers.delete(s.timer)
        flushSync(file)
      }
      for (const [file, d] of [...disk]) {
        // a write that may still be claimed keeps its timer: its event names the agent, after the compile's
        if (claimWait(file, d.at)) continue
        clearTimeout(d.timer)
        timers.delete(d.timer)
        flushDisk(file)
      }
    },
    dispose() {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    },
  }
}
