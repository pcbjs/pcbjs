// The extension without vscode: the one server, the language client of each session link, which session owns a file, the document
// handoff and the cursor sync. The extension and the edit-path harness both run it, each with its own language client.

import { fileURLToPath } from 'node:url'
import { PcbjsServer, type ServerOptions } from './server'
import type { Lsp, SessionLink } from './link'
import type { Phase } from './phase'
import { Holders, type DocPeer, type OpenDoc, type PcbjsSession } from './lsp-client'
import { Sync, type SyncTarget } from './sync'
import { offers } from './protocol'

export interface WiringOptions extends Omit<ServerOptions, 'onLink' | 'onChange'> {
  /** the language client over a link, undefined when it does not answer; `owns` gates it to the files the link serves */
  language(link: SessionLink, owns: (file: string) => boolean, holders: Holders): Promise<Lsp | undefined>
  /** the open design documents, for the handoff */
  docs(): OpenDoc[]
  /** a link said ready, before its language client starts */
  onLink?(link: SessionLink): void
  /** a language client came or went, or documents moved between them */
  onMoved?(): void
  /** the active file and cursor sent again, to the files `accepts` holds */
  onResync?(accepts: (file: string) => boolean): void
  onChange?(prev: Phase, next: Phase): void
}

const fileOf = (uri: string): string | undefined => (uri.startsWith('file:') ? fileURLToPath(uri) : undefined)

export class Wiring {
  readonly server: PcbjsServer
  readonly holders = new Holders()
  readonly sync: Sync
  /** the sessions and their roots at the last change, so the handoff runs once per change of them */
  private shape = ''
  private closing = false
  private disposal?: Promise<void>
  private readonly disposed = new WeakMap<Lsp, Promise<void>>()

  constructor(private readonly o: WiringOptions) {
    this.server = new PcbjsServer({
      ...o,
      onLink: link => void this.linked(link),
      onChange: (prev, next) => {
        if (this.closing) return
        this.reshaped()
        o.onChange?.(prev, next)
      },
    })
    this.sync = new Sync({ route: file => this.target(file) })
  }

  /** The language session of the link that owns the file, while its client runs. */
  sessionOf(file: string): PcbjsSession | undefined {
    return this.server.owner(file)?.link.lsp?.session
  }

  /** Every open document to the client of the session that now owns it; a closed session's documents move to one that covers them. */
  handoff(): void {
    if (this.closing) return
    const moved = this.holders.move(this.o.docs(), uri => this.peerOf(uri))
    if (moved.length) this.o.onMoved?.()
  }

  dispose(timeoutMs = 1500): Promise<void> {
    if (this.disposal) return this.disposal
    this.closing = true
    this.sync.dispose()
    const pending = this.server.links.flatMap(l => (l.lsp ? [this.disposeLanguage(l.lsp)] : []))
    this.disposal = (async () => {
      await this.server.dispose()
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          Promise.all(pending),
          new Promise<void>(done => {
            timer = setTimeout(done, timeoutMs)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    })()
    return this.disposal
  }

  private disposeLanguage(lsp: Lsp): Promise<void> {
    let pending = this.disposed.get(lsp)
    if (!pending) {
      pending = Promise.resolve()
        .then(() => lsp.dispose())
        .catch(e => {
          this.o.output?.(`[lsp] shutdown: ${String(e)}`)
        })
      this.disposed.set(lsp, pending)
    }
    return pending
  }

  private peerOf(uri: string): DocPeer | undefined {
    const file = fileOf(uri)
    return file ? this.server.owner(file)?.link.lsp?.peer : undefined
  }

  private target(file: string): SyncTarget | undefined {
    const owner = this.server.owner(file)
    if (!owner) return undefined
    const { link, root } = owner
    // the cursor and the active file reach the session through its language server only
    return {
      root,
      focus: at => {
        const s = link.lsp?.session
        if (!s) return false
        void s.focus(at)
        return true
      },
    }
  }

  /** The handoff, when a link, its roots or its language client changed since the last. */
  private reshaped(): void {
    const shape = this.server.links.map(l => `${l.session}${l.lsp ? '+lsp' : ''}=${l.roots.join(',')}`).join('|')
    if (shape === this.shape) return
    this.shape = shape
    this.handoff()
  }

  private async linked(link: SessionLink): Promise<void> {
    if (this.closing) return link.close()
    this.o.onLink?.(link)
    const owns = (file: string) => this.server.owner(file)?.link === link
    let lsp: Lsp | undefined
    try {
      lsp = link.info && offers(link.info, 'lsp') ? await this.o.language(link, owns, this.holders) : undefined
    } catch (e) {
      this.o.output?.(`[lsp] initialize: ${String(e)}`)
    }
    if (this.closing || !link.open) {
      if (lsp) void this.disposeLanguage(lsp)
      return
    }
    if (lsp) {
      link.lsp = lsp
      link.onClose(() => {
        link.lsp = undefined
        void this.disposeLanguage(lsp!)
        if (this.closing) return
        this.reshaped()
        this.o.onMoved?.()
      })
      this.reshaped()
      this.o.onMoved?.()
    }
    this.o.onResync?.(owns)
  }
}
