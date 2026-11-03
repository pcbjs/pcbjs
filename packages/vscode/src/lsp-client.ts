import { AbstractMessageReader, AbstractMessageWriter, type DataCallback, type Disposable, type Message, type MessageReader, type MessageWriter } from 'vscode-jsonrpc'
import {
  MAJOR,
  METHODS,
  PROTOCOL,
  type ClientHello,
  type Position,
  type Presentation,
  type Range,
  type Segment,
  type SelectParams,
  type TextEdit,
  type UnitToken,
} from '@pcbjs/core/protocol'
import type { SignatureHelp } from 'vscode-languageclient/node'
import type { FocusAt } from './sync'

export function initializationOptions(version: string): { pcbjs: ClientHello } {
  return { pcbjs: { protocol: PROTOCOL, major: MAJOR, capabilities: ['tokens'], name: 'vscode-pcbjs', version } }
}

const SYNC = ['didOpen', 'didChange', 'didSave', 'didClose'] as const
const PROVIDERS = [
  'provideHover',
  'provideSignatureHelp',
  'provideCompletionItem',
  'provideDefinition',
  'provideDocumentHighlights',
  'provideCodeLenses',
  'provideCodeActions',
  'provideInlayHints',
  'provideDocumentSemanticTokens',
  'provideDocumentSemanticTokensEdits',
  'provideDocumentRangeSemanticTokens',
] as const
type Next = (...args: any[]) => any
const uriOf = (arg: any): string => String((arg?.document ?? arg)?.uri)

/** One language client as the document handoff sees it. */
export interface DocPeer {
  alive(): boolean
  notify(method: string, params: unknown): void
}

export interface OpenDoc {
  uri: string
  languageId: string
  version: number
  text: string
}

/** Which client each open document was last opened on, so a document follows the session that serves it. */
export class Holders {
  private readonly by = new Map<string, DocPeer>()

  /** `peer` opened it: the client that had it before closes it while it lives. */
  hold(uri: string, peer: DocPeer): void {
    const prev = this.by.get(uri)
    if (prev && prev !== peer && prev.alive()) prev.notify('textDocument/didClose', { textDocument: { uri } })
    this.by.set(uri, peer)
  }

  drop(uri: string, peer: DocPeer): void {
    if (this.by.get(uri) === peer) this.by.delete(uri)
  }

  /** Each document whose serving client changed: closed on the old one while it lives, opened on the new one; the uris moved. */
  move(docs: OpenDoc[], owner: (uri: string) => DocPeer | undefined): string[] {
    const moved: string[] = []
    for (const d of docs) {
      const prev = this.by.get(d.uri)
      const next = owner(d.uri)
      if (prev === next) continue
      if (prev?.alive()) prev.notify('textDocument/didClose', { textDocument: { uri: d.uri } })
      if (next) {
        next.notify('textDocument/didOpen', { textDocument: d })
        this.by.set(d.uri, next)
      } else this.by.delete(d.uri)
      moved.push(d.uri)
    }
    return moved
  }
}

/** vscode-languageclient middleware that keeps a client to the documents `owns` gives its session: every attached session runs a client over the whole workspace, so without it each one syncs, hints, hovers and lenses every file. `track` records what it opens and closes. */
export function ownedMiddleware(owns: (uri: string) => boolean, track?: { holders: Holders; peer: DocPeer }): Record<string, Next> {
  const gate =
    (skip: () => unknown) =>
    (...args: any[]) =>
      owns(uriOf(args[0])) ? (args.at(-1) as Next)(...args.slice(0, -1)) : skip()
  const mw: Record<string, Next> = {
    handleDiagnostics: (uri: unknown, diags: unknown[], next: Next) => next(uri, owns(String(uri)) ? diags : []),
  }
  for (const k of SYNC) mw[k] = gate(() => Promise.resolve())
  for (const k of PROVIDERS) mw[k] = gate(() => undefined)
  if (track) {
    const { didOpen, didClose } = mw
    mw.didOpen = (doc: any, next: Next) => {
      if (owns(uriOf(doc))) track.holders.hold(uriOf(doc), track.peer)
      return didOpen(doc, next)
    }
    mw.didClose = (doc: any, next: Next) => {
      if (owns(uriOf(doc))) track.holders.drop(uriOf(doc), track.peer)
      return didClose(doc, next)
    }
  }
  return mw
}

export interface RpcChannel {
  sendRpc(msg: unknown): boolean
  onRpc(cb: (msg: unknown) => void): () => void
  onClose(cb: () => void): () => void
}

class ChannelReader extends AbstractMessageReader {
  private callback: DataCallback | undefined
  private readonly queue: Message[] = []
  constructor(channel: RpcChannel) {
    super()
    channel.onRpc(m => (this.callback ? this.callback(m as Message) : this.queue.push(m as Message)))
    channel.onClose(() => this.fireClose())
  }
  listen(callback: DataCallback): Disposable {
    this.callback = callback
    for (const m of this.queue.splice(0)) callback(m)
    return { dispose: () => (this.callback = undefined) }
  }
}

class ChannelWriter extends AbstractMessageWriter {
  constructor(private readonly channel: RpcChannel) {
    super()
  }
  async write(msg: Message): Promise<void> {
    if (!this.channel.sendRpc(msg)) {
      const err = new Error('the session connection is closed')
      this.fireError(err, msg, 1)
      throw err
    }
  }
  end(): void {}
}

/** vscode-languageclient's MessageTransports. */
export function transports(channel: RpcChannel): { reader: MessageReader; writer: MessageWriter } {
  return { reader: new ChannelReader(channel), writer: new ChannelWriter(channel) }
}

/** LanguageClient and MessageConnection both have it. */
export interface Rpc {
  sendNotification(method: string, params?: unknown): Promise<void> | void
  sendRequest<R>(method: string, params?: unknown): Promise<R>
  onNotification(method: string, handler: (params: any) => void): { dispose(): void }
}

export interface EditorPort {
  select(p: SelectParams): void | Promise<void>
  preview(url: string, scope?: string | null): void
  /** one undoable change */
  applyEdit(uri: string, edits: TextEdit[]): Promise<boolean>
  uri(file: string): string
}

export class PcbjsSession {
  private readonly subs: { dispose(): void }[] = []
  private padHelp: { key: string; result: Promise<SignatureHelp | null> } | undefined
  constructor(
    private readonly rpc: Rpc,
    private readonly port: EditorPort,
  ) {
    this.subs.push(
      rpc.onNotification(METHODS.select, p => {
        if (p && Array.isArray(p.items) && p.items.length && p.primary && typeof p.primary.uri === 'string') void port.select(p as SelectParams)
      }),
      rpc.onNotification(METHODS.preview, p => {
        if (p && typeof p.url === 'string') port.preview(p.url, p.scope)
      }),
    )
  }

  /** `pcbjs/focus`, 1-based, with every editor selection, the primary first. */
  async focus(at: FocusAt): Promise<void> {
    const position = { line: Math.max(0, at.line - 1), character: Math.max(0, at.col - 1) }
    try {
      await this.rpc.sendNotification(METHODS.focus, {
        textDocument: { uri: this.port.uri(at.file) },
        position,
        selections: at.ranges?.length ? at.ranges : [{ start: position, end: position }],
      })
    } catch {}
  }

  async signature(uri: string, position: Position, version?: number): Promise<boolean> {
    const pending = {
      key: JSON.stringify([uri, version, position.line, position.character]),
      result: this.rpc.sendRequest<SignatureHelp | null>('textDocument/signatureHelp', { textDocument: { uri }, position }),
    }
    this.padHelp = version === undefined ? undefined : pending
    try {
      const result = await pending.result
      const eligible = !!result?.signatures?.length
      if (!eligible && this.padHelp === pending) this.padHelp = undefined
      return eligible
    } catch (error) {
      if (this.padHelp === pending) this.padHelp = undefined
      throw error
    }
  }

  /** The native provider consumes the exact caret preflight once, without a second render request. */
  takeSignature(uri: string, position: Position, version: number): Promise<SignatureHelp | null> | undefined {
    const pending = this.padHelp
    this.padHelp = undefined
    return pending?.key === JSON.stringify([uri, version, position.line, position.character]) ? pending.result : undefined
  }

  clearSignature(): void {
    this.padHelp = undefined
  }

  async segments(uri: string, range?: Range): Promise<Segment[]> {
    return (await this.rpc.sendRequest<Segment[]>(METHODS.segments, { textDocument: { uri }, ...(range ? { range } : {}) })) ?? []
  }

  async segmentAt(uri: string, position: Position): Promise<Segment | undefined> {
    return (await this.rpc.sendRequest<Segment[]>(METHODS.segments, { textDocument: { uri }, position }))?.[0]
  }

  async typed(uri: string, position: Position, value: string): Promise<Segment | undefined> {
    return (await this.rpc.sendRequest<Segment[]>(METHODS.segments, { textDocument: { uri }, position, value }))?.[0]
  }

  async tokens(uri: string): Promise<UnitToken[]> {
    return (await this.rpc.sendRequest<{ tokens: UnitToken[] }>(METHODS.tokens, { textDocument: { uri } }))?.tokens ?? []
  }

  apply(uri: string, p: Presentation): Promise<boolean> {
    return this.port.applyEdit(uri, [p.edit])
  }

  dispose(): void {
    this.clearSignature()
    this.subs.forEach(s => s.dispose())
  }
}
