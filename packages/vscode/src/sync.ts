// The cursor, the active file and their selections as the session's `pcbjs/focus`, throttled to a frame. No vscode import, so the tests load it.

import * as path from 'node:path'
import type { Range } from '@pcbjs/core/protocol'

/** 1-based, with every selection of the editor as 0-based LSP ranges, the primary first. */
export interface FocusAt {
  file: string
  line: number
  col: number
  ranges?: Range[]
}

export interface SyncTarget {
  readonly root: string
  /** false when the session's language client does not run */
  focus(at: FocusAt): boolean
}

export interface SyncOptions {
  route(file: string): SyncTarget | undefined
  /** the shortest time between two cursor events, 16 ms, one frame; the first of a burst goes at once */
  frameMs?: number
  extensions?: string[]
}

export class Sync {
  cursorSync = true
  followFocus = true
  private pending: FocusAt | undefined
  private timer: NodeJS.Timeout | undefined
  private lastFocus: { file: string; root: string } | undefined
  /** the last cursor sent and where it went, until the cursor leaves the design files */
  private lastCursor: { file: string; target: SyncTarget } | undefined
  /** the last cursor sent anywhere, which a focus of its file carries */
  private lastAt: FocusAt | undefined
  private readonly frameMs: number
  private readonly extensions: string[]

  constructor(private readonly opts: SyncOptions) {
    this.frameMs = opts.frameMs ?? 16
    this.extensions = opts.extensions ?? ['.ts', '.tsx']
  }

  accepts(file: string): boolean {
    return this.extensions.includes(path.extname(file).toLowerCase())
  }

  /** 1-based, with every selection of the editor, the primary first; the first move goes at once, then the last of each frame, so a held arrow key streams. */
  cursor(file: string, line: number, col: number, ranges?: Range[]): void {
    if (!this.cursorSync) return
    if (!this.accepts(file)) {
      this.leave()
      return
    }
    this.pending = { file, line, col, ...(ranges?.length ? { ranges } : {}) }
    if (!this.timer) this.tick()
  }

  /** Sends 1:1 of the last file, which no range holds, so the viewers clear the highlight; once per leave. */
  leave(): boolean {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
    const last = this.lastCursor
    this.lastCursor = undefined
    if (!this.cursorSync || !last) return false
    return this.to(last.target, { file: last.file, line: 1, col: 1 })
  }

  private tick(): void {
    const p = this.pending
    this.pending = undefined
    if (!p) {
      this.timer = undefined
      return
    }
    this.send(p)
    this.timer = setTimeout(() => this.tick(), this.frameMs)
  }

  private send(p: FocusAt): void {
    const target = this.opts.route(p.file)
    if (target && this.to(target, p)) this.lastCursor = { file: p.file, target }
  }

  private to(target: SyncTarget, at: FocusAt): boolean {
    if (!target.focus(at)) return false
    this.lastAt = at
    return true
  }

  /** The active file, with its last cursor; not repeated for the same file and server. */
  focus(file: string, force = false): boolean {
    if (!this.followFocus || !this.accepts(file)) return false
    const target = this.opts.route(file)
    if (!target) return false
    if (!force && this.lastFocus && this.lastFocus.file === file && this.lastFocus.root === target.root) return false
    if (!target.focus(this.lastAt?.file === file ? this.lastAt : { file, line: 1, col: 1 })) return false
    this.lastFocus = { file, root: target.root }
    return true
  }

  /** A closed file: the document sync tells the session, and its next focus goes out again. */
  close(file: string): boolean {
    if (!this.accepts(file)) return false
    const target = this.opts.route(file)
    if (!target) return false
    if (this.lastFocus && this.lastFocus.file === file && this.lastFocus.root === target.root) this.lastFocus = undefined
    return true
  }

  /** For a server that just connected again: the next focus goes out. */
  resetFocus(): void {
    this.lastFocus = undefined
  }

  /** Send the cursor still waiting for its frame now. */
  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    const p = this.pending
    this.pending = undefined
    if (p) this.send(p)
  }

  dispose(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
  }
}
