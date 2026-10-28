// No vscode import, so the tests load it.

import * as path from 'node:path'
import { EVENTS } from './protocol'

export interface SyncTarget {
  readonly root: string
  send(event: string, data: unknown): boolean
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
  private pending: { file: string; line: number; col: number } | undefined
  private timer: NodeJS.Timeout | undefined
  private lastFocus: { file: string; root: string } | undefined
  /** the last cursor sent and where it went, until the cursor leaves the design files */
  private lastCursor: { file: string; target: SyncTarget } | undefined
  private readonly frameMs: number
  private readonly extensions: string[]

  constructor(private readonly opts: SyncOptions) {
    this.frameMs = opts.frameMs ?? 16
    this.extensions = opts.extensions ?? ['.ts', '.tsx']
  }

  accepts(file: string): boolean {
    return this.extensions.includes(path.extname(file).toLowerCase())
  }

  /** 1-based; the first move goes at once, then the last of each frame, so a held arrow key streams. */
  cursor(file: string, line: number, col: number): void {
    if (!this.cursorSync) return
    if (!this.accepts(file)) {
      this.leave()
      return
    }
    this.pending = { file, line, col }
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
    return last.target.send(EVENTS.cursor, { file: last.file, line: 1, col: 1 })
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

  private send(p: { file: string; line: number; col: number }): void {
    const target = this.opts.route(p.file)
    if (target?.send(EVENTS.cursor, p)) this.lastCursor = { file: p.file, target }
  }

  /** Not repeated for the same file and server. */
  focus(file: string, force = false): boolean {
    if (!this.followFocus || !this.accepts(file)) return false
    const target = this.opts.route(file)
    if (!target) return false
    if (!force && this.lastFocus && this.lastFocus.file === file && this.lastFocus.root === target.root) return false
    if (!target.send(EVENTS.focus, { file })) return false
    this.lastFocus = { file, root: target.root }
    return true
  }

  /** The server drops the file's isolated preview. */
  close(file: string): boolean {
    if (!this.accepts(file)) return false
    const target = this.opts.route(file)
    if (!target) return false
    if (this.lastFocus && this.lastFocus.file === file && this.lastFocus.root === target.root) this.lastFocus = undefined
    return target.send(EVENTS.close, { file })
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
