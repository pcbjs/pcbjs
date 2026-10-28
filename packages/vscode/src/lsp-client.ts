import { AbstractMessageReader, AbstractMessageWriter, type DataCallback, type Disposable, type Message, type MessageReader, type MessageWriter } from 'vscode-jsonrpc'
import { EVENTS, MAJOR, PROTOCOL } from './protocol'

/** Frozen at protocol 1 for servers without `widget`; a server with it sends every kind with its widget. */
export const CLIENT_KINDS = ['number', 'length', 'angle', 'position', 'layer', 'enum', 'pathCommand', 'pinRef'] as const

export const METHODS = { focus: 'pcbjs/focus', select: 'pcbjs/select', preview: 'pcbjs/preview', segments: 'pcbjs/segments' } as const

export interface Position {
  line: number
  character: number
}
export interface Range {
  start: Position
  end: Position
}
export interface TextEdit {
  range: Range
  newText: string
}
export interface Presentation {
  label: string
  detail?: string
  edit: TextEdit
}
/** An unknown `input` is edited as text. */
export interface Widget {
  input: string
  typed: boolean
  prompt?: string
  options?: string[]
  unit?: string
  min?: number
  max?: number
  step?: number
  /** a CSS colour */
  preview?: string
}
export interface Segment {
  range: Range
  kind: string
  value: string
  label: string
  constraints: { unit?: string; min?: number; max?: number; step?: number; choices?: string[]; grammar?: string; index?: number }
  presentations: Presentation[]
  widget?: Widget
  error?: string
}

export interface ClientHello {
  protocol: number
  major: number
  kinds: string[]
  capabilities: string[]
  name: string
  version: string
}

export function initializationOptions(version: string): { pcbjs: ClientHello } {
  return { pcbjs: { protocol: PROTOCOL, major: MAJOR, kinds: [...CLIENT_KINDS], capabilities: ['widget'], name: 'vscode-pcbjs', version } }
}

/** The widget of a segment: the server's, else one inferred from protocol 1 kinds. */
export function widgetOf(seg: Segment): Widget {
  if (seg.widget && typeof seg.widget.input === 'string') return { ...seg.widget, typed: seg.widget.typed !== false }
  return { input: seg.kind === 'enum' ? 'enum' : 'text', typed: seg.kind !== 'enum', options: seg.constraints?.choices }
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
      const err = new Error('the dev server connection is closed')
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
  select(uri: string, range: Range): void | Promise<void>
  preview(url: string, scope?: string | null): void
  /** one undoable change */
  applyEdit(uri: string, edits: TextEdit[]): Promise<boolean>
  uri(file: string): string
}

export class PcbjsSession {
  private readonly subs: { dispose(): void }[] = []
  private last: { file: string; line: number; col: number } | undefined
  constructor(
    private readonly rpc: Rpc,
    private readonly port: EditorPort,
  ) {
    this.subs.push(
      rpc.onNotification(METHODS.select, p => {
        if (p && typeof p.uri === 'string' && p.range) void port.select(p.uri, p.range)
      }),
      rpc.onNotification(METHODS.preview, p => {
        if (p && typeof p.url === 'string') port.preview(p.url, p.scope)
      }),
    )
  }

  /** sync.ts events as `pcbjs/focus`; false for an event it does not carry. A close needs nothing, the document sync says it. */
  relay(event: string, data: any): boolean {
    if (event === EVENTS.focus && typeof data?.file === 'string') {
      const c = this.last?.file === data.file ? this.last : undefined
      void this.notify(data.file, c ? c.line : 1, c ? c.col : 1)
      return true
    }
    if (event === EVENTS.cursor && typeof data?.file === 'string') {
      this.last = { file: data.file, line: data.line, col: data.col }
      void this.notify(data.file, data.line, data.col)
      return true
    }
    return event === EVENTS.close
  }

  private async notify(file: string, line: number, col: number): Promise<void> {
    try {
      await this.rpc.sendNotification(METHODS.focus, { textDocument: { uri: this.port.uri(file) }, position: { line: Math.max(0, line - 1), character: Math.max(0, col - 1) } })
    } catch {}
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

  apply(uri: string, p: Presentation): Promise<boolean> {
    return this.port.applyEdit(uri, [p.edit])
  }

  dispose(): void {
    this.subs.forEach(s => s.dispose())
  }
}
