// The WebSocket every spawned dev server dials with `--ide=<url>`: events and JSON-RPC frames on one socket.

import * as http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { BoardsInfo, EVENTS, LogEvent, ReadyInfo, ScopeInfo, ScopesInfo, SelectRequest, encode, hello, isUnder, parseEnvelope, parseRpc, tooNew, validBoards, validReady, validSelect } from './protocol';

/** A PcbjsServer, once a ready names it. */
export interface HostTarget {
  onReady(info: ReadyInfo, client: HostedClient): void;
  onBoards(data: BoardsInfo, client: HostedClient): void;
  onLog(data: LogEvent, client: HostedClient): void;
  onScopes?(data: ScopesInfo, client: HostedClient): void;
  onScope?(data: ScopeInfo, client: HostedClient): void;
  onClosed(client: HostedClient): void;
}

export interface HostEditor {
  select(req: SelectRequest): void | Promise<void>;
  log?(message: string): void;
}

export interface HostOptions {
  editor: HostEditor;
  target?(info: ReadyInfo, client: HostedClient): HostTarget | undefined;
  /** after hello went out, and again after the first ready */
  onConnect?(client: HostedClient): void;
  onChange?(): void;
  /** a server whose protocol major is newer than this extension's: once per connection, with the notice */
  onTooNew?(notice: string, client: HostedClient): void;
  name?: string;
  version?: string;
  host?: string;
  port?: number;
  token?: string;
  pingMs?: number;
}

let nextId = 1;

export class HostedClient {
  readonly id = nextId++;
  info: ReadyInfo | undefined;
  boards: BoardsInfo | undefined;
  target: HostTarget | undefined;
  alive = true;
  private readonly rpcListeners = new Set<(msg: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(readonly socket: WebSocket) {}

  sendRpc(msg: unknown): boolean {
    if (!this.open) return false;
    try {
      this.socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  onRpc(cb: (msg: unknown) => void): () => void {
    this.rpcListeners.add(cb);
    return () => this.rpcListeners.delete(cb);
  }

  onClose(cb: () => void): () => void {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  /** @internal */
  emitRpc(msg: unknown): void {
    for (const cb of [...this.rpcListeners]) cb(msg);
  }

  /** @internal */
  emitClose(): void {
    for (const cb of [...this.closeListeners]) cb();
    this.closeListeners.clear();
    this.rpcListeners.clear();
  }

  get root(): string | undefined {
    return this.info?.root;
  }

  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(event: string, data?: unknown): boolean {
    if (!this.open) return false;
    try {
      this.socket.send(encode(event, data));
      return true;
    } catch {
      return false;
    }
  }
}

export class IdeHost {
  readonly clients = new Set<HostedClient>();
  readonly token: string;
  private server: http.Server | undefined;
  private wss: WebSocketServer | undefined;
  private ping: NodeJS.Timeout | undefined;
  private address: { host: string; port: number } | undefined;
  private readonly opts: HostOptions & { name: string; version: string; host: string; pingMs: number };

  constructor(options: HostOptions) {
    this.opts = { name: 'vscode-pcbjs', version: '0.0.0', host: '127.0.0.1', pingMs: 15000, ...options };
    this.token = options.token ?? randomBytes(18).toString('base64url');
  }

  /** `ws://127.0.0.1:<port>/<token>`, once listening */
  get url(): string {
    if (!this.address) throw new Error('the IDE host is not listening');
    return `ws://${this.address.host}:${this.address.port}/${this.token}`;
  }

  get listening(): boolean {
    return !!this.address;
  }

  async listen(): Promise<string> {
    if (this.address) return this.url;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
    const server = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    server.on('upgrade', (req, socket, head) => {
      if (!this.accepts(req.url)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.connection(ws));
    });
    await new Promise<void>((ok, fail) => {
      server.once('error', fail);
      server.listen(this.opts.port ?? 0, this.opts.host, () => {
        server.off('error', fail);
        ok();
      });
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('the IDE host has no TCP address');
    this.server = server;
    this.wss = wss;
    this.address = { host: this.opts.host, port: addr.port };
    this.ping = setInterval(() => this.heartbeat(), this.opts.pingMs);
    this.ping.unref?.();
    return this.url;
  }

  /** Only the exact `/<token>` path, compared in constant time. */
  accepts(reqUrl: string | undefined): boolean {
    let p: string;
    try {
      p = new URL(reqUrl ?? '/', 'http://x').pathname;
    } catch {
      return false;
    }
    const want = Buffer.from(`/${this.token}`);
    const got = Buffer.from(p);
    return got.length === want.length && timingSafeEqual(got, want);
  }

  async close(): Promise<void> {
    clearInterval(this.ping);
    this.ping = undefined;
    for (const c of this.clients) {
      c.send(EVENTS.bye);
      try {
        c.socket.close(1001);
      } catch {}
    }
    const server = this.server;
    const wss = this.wss;
    this.server = undefined;
    this.wss = undefined;
    this.address = undefined;
    await new Promise((r) => setTimeout(r, 20));
    for (const c of this.clients) c.socket.terminate();
    wss?.close();
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  /** The deepest root or folder that contains the file. */
  route(file: string): HostedClient | undefined {
    let best: HostedClient | undefined;
    let bestLen = -1;
    for (const c of this.clients) {
      if (!c.info || !c.open) continue;
      for (const root of [c.info.root, ...(Array.isArray(c.info.folders) ? c.info.folders : [])]) {
        if (typeof root !== 'string' || !isUnder(root, file) || root.length <= bestLen) continue;
        best = c;
        bestLen = root.length;
      }
    }
    return best;
  }

  private connection(ws: WebSocket): void {
    const client = new HostedClient(ws);
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (raw) => this.handle(client, raw));
    ws.on('error', (err) => this.log(`ide socket error: ${err.message}`));
    ws.on('close', () => {
      client.emitClose();
      if (!this.clients.delete(client)) return;
      try {
        client.target?.onClosed(client);
      } catch (err) {
        this.log(`close handler failed: ${(err as Error).message}`);
      }
      this.opts.onChange?.();
    });
    client.send(EVENTS.hello, hello(this.opts.name, this.opts.version));
    this.opts.onConnect?.(client);
    this.opts.onChange?.();
  }

  private handle(client: HostedClient, raw: unknown): void {
    const rpc = parseRpc(raw);
    if (rpc) {
      client.emitRpc(rpc);
      return;
    }
    const msg = parseEnvelope(raw);
    if (!msg) {
      this.log('ignored a malformed ide message');
      return;
    }
    switch (msg.event) {
      case EVENTS.ready: {
        if (!validReady(msg.data)) {
          this.log(`ignored malformed ready: ${JSON.stringify(msg.data)}`);
          return;
        }
        const first = !client.info;
        client.info = msg.data;
        const notice = first ? tooNew(msg.data) : undefined;
        if (notice) this.opts.onTooNew?.(notice, client);
        const target = this.opts.target?.(msg.data, client);
        if (target && target !== client.target) client.target = target;
        client.target?.onReady(msg.data, client);
        if (first && client.boards) client.target?.onBoards(client.boards, client);
        if (first) this.opts.onConnect?.(client);
        this.opts.onChange?.();
        return;
      }
      case EVENTS.boards:
        if (!validBoards(msg.data)) {
          this.log(`ignored malformed boards: ${JSON.stringify(msg.data)}`);
          return;
        }
        client.boards = msg.data;
        client.target?.onBoards(msg.data, client);
        this.opts.onChange?.();
        return;
      case EVENTS.scopes:
        if (!msg.data || !Array.isArray(msg.data.scopes)) return;
        client.target?.onScopes?.(msg.data, client);
        return;
      case EVENTS.scope:
        if (!msg.data || typeof msg.data.scope !== 'string') return;
        client.target?.onScope?.(msg.data, client);
        return;
      case EVENTS.log: {
        const d = msg.data ?? {};
        const ev: LogEvent = { level: String(d.level ?? 'info'), text: String(d.text ?? '') };
        if (client.target) client.target.onLog(ev, client);
        else this.log(`[${ev.level}] ${ev.text}`);
        return;
      }
      case EVENTS.select:
        if (!validSelect(msg.data)) {
          this.log(`ignored malformed select: ${JSON.stringify(msg.data)}`);
          return;
        }
        Promise.resolve()
          .then(() => this.opts.editor.select(msg.data))
          .catch((err) => this.log(`select failed: ${err?.message ?? err}`));
        return;
      case EVENTS.bye:
        try {
          client.socket.close(1000);
        } catch {}
        return;
      default:
        return;
    }
  }

  private heartbeat(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.socket.ping();
      } catch {}
    }
  }

  private log(message: string): void {
    this.opts.editor.log?.(message);
  }
}
