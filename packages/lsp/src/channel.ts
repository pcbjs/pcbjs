// JSON-RPC with one parsed message per frame, as the pcbjs WebSocket carries them, not Content-Length framing.

import { AbstractMessageReader, AbstractMessageWriter, type DataCallback, type Disposable, type Message, type MessageReader, type MessageWriter } from 'vscode-jsonrpc'

/** True for a frame that is a JSON-RPC message rather than a `{ event, data }` envelope. */
export function isRpcMessage(msg: unknown): msg is Message {
  return !!msg && typeof msg === 'object' && (msg as { jsonrpc?: unknown }).jsonrpc === '2.0'
}

/** True for the `initialize` request, the message that makes a dev server load the language server. */
export function isInitialize(msg: unknown): boolean {
  return isRpcMessage(msg) && (msg as { method?: unknown }).method === 'initialize'
}

class ChannelReader extends AbstractMessageReader {
  private callback: DataCallback | undefined
  private readonly queue: Message[] = []
  listen(callback: DataCallback): Disposable {
    this.callback = callback
    for (const m of this.queue.splice(0)) callback(m)
    return {
      dispose: () => {
        if (this.callback === callback) this.callback = undefined
      },
    }
  }
  push(msg: Message): void {
    if (this.callback) this.callback(msg)
    else this.queue.push(msg)
  }
  close(): void {
    this.fireClose()
  }
}

class ChannelWriter extends AbstractMessageWriter {
  constructor(private readonly send: (msg: Message) => boolean | void) {
    super()
  }
  async write(msg: Message): Promise<void> {
    try {
      if (this.send(msg) === false) throw new Error('the channel is closed')
    } catch (err) {
      this.fireError(err as Error, msg, 1)
      throw err
    }
  }
  end(): void {}
  close(): void {
    this.fireClose()
  }
}

export interface MessageChannel {
  reader: MessageReader
  writer: MessageWriter
  /** hand one incoming message to the reader */
  push(msg: Message): void
  /** the channel went away: both ends report close */
  close(): void
}

/** A reader and a writer over a channel whose `send` takes one message. */
export function messageChannel(send: (msg: Message) => boolean | void): MessageChannel {
  const reader = new ChannelReader()
  const writer = new ChannelWriter(send)
  return {
    reader,
    writer,
    push: msg => reader.push(msg),
    close: () => {
      reader.close()
      writer.close()
    },
  }
}
