// A hosted server's root wins over its dev.json.

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import WebSocket from 'ws';
import { Bridge, Connection, DevInfo, followsDevJson } from './bridge';
import { SelectRequest, isUnder, tooNew } from './protocol';
import type { SyncTarget } from './sync';

const DEV_JSON_GLOB = '**/.pcbjs/dev.json';

export interface FallbackOptions {
  version: string;
  output: vscode.OutputChannel;
  isHosted(info: DevInfo): boolean;
  onTooNew?(notice: string): void;
  select(req: SelectRequest): Promise<void>;
  onChange(): void;
}

export class FallbackBridge implements vscode.Disposable {
  readonly bridge: Bridge;
  /** pcbjs.disconnect, until pcbjs.connect */
  private manualOff = false;
  /** pcbjs.connect: follow dev.json even with pcbjs.followDevJson off */
  private asked = false;
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly opts: FallbackOptions) {
    this.bridge = new Bridge({
      name: 'vscode-pcbjs',
      version: opts.version,
      createSocket: (url, protocol) => new WebSocket(url, protocol),
      editor: {
        select: (req) => opts.select(req),
        log: (message) => opts.output.appendLine(`[external] ${message}`),
      },
      onStateChange: () => opts.onChange(),
    });
    // cursor and focus go through sync.ts
    this.bridge.cursorSync = false;
    this.subs.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.watch();
        void this.scan();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('pcbjs.autoConnect') && this.shouldConnect()) this.bridge.connectAll();
        if (e.affectsConfiguration('pcbjs.followDevJson')) void this.scan();
      }),
    );
    this.watch();
    void this.scan();
  }

  private follows(): boolean {
    return followsDevJson(vscode.workspace.getConfiguration('pcbjs').get<boolean>('followDevJson', true), this.asked);
  }

  private shouldConnect(): boolean {
    return !this.manualOff && vscode.workspace.getConfiguration('pcbjs').get<boolean>('autoConnect', true);
  }

  route(file: string): SyncTarget | undefined {
    const conn = this.bridge.route(file);
    if (!conn || conn.state !== 'connected') return undefined;
    return { root: conn.info.root, send: (event, data) => conn.send(event, data) };
  }

  /** for this root or a project inside it */
  forRoot(root: string): Connection | undefined {
    for (const c of this.bridge.connections.values()) if (c.state === 'connected' && c.info.root === root) return c;
    for (const c of this.bridge.connections.values()) if (c.state === 'connected' && isUnder(root, c.info.root)) return c;
    return undefined;
  }

  get connections(): Connection[] {
    return [...this.bridge.connections.values()];
  }

  async connect(): Promise<number> {
    this.manualOff = false;
    this.asked = true;
    await this.scan();
    this.bridge.connectAll();
    return this.bridge.connections.size;
  }

  /** Restart the connections of this root or of projects inside it; false when there are none. */
  reconnect(root: string): boolean {
    const conns = this.connections.filter((c) => c.info.root === root || isUnder(root, c.info.root));
    for (const c of conns) {
      c.stop();
      c.start();
    }
    return conns.length > 0;
  }

  disconnect(): void {
    this.manualOff = true;
    this.asked = false;
    this.bridge.disconnectAll();
  }

  async scan(): Promise<void> {
    if (!this.follows()) {
      for (const key of [...this.bridge.connections.keys()]) this.bridge.remove(key);
      this.opts.onChange();
      return;
    }
    const found = await vscode.workspace.findFiles(DEV_JSON_GLOB, '**/node_modules/**');
    const keys = new Set(found.map((u) => u.fsPath));
    for (const key of [...this.bridge.connections.keys()]) if (!keys.has(key)) this.bridge.remove(key);
    await Promise.all(found.map((u) => this.load(u)));
    this.opts.onChange();
  }

  private async load(uri: vscode.Uri): Promise<void> {
    if (!this.follows()) return;
    let info: DevInfo;
    try {
      info = JSON.parse(await fs.readFile(uri.fsPath, 'utf8'));
    } catch {
      // still being written; the change event brings us back
      return;
    }
    if (!info || typeof info.port !== 'number' || typeof info.root !== 'string') return;
    if ((typeof info.pid === 'number' && !alive(info.pid)) || this.opts.isHosted(info)) {
      this.bridge.remove(uri.fsPath);
      return;
    }
    const notice = tooNew(info);
    if (notice) this.opts.onTooNew?.(notice);
    this.bridge.upsert(uri.fsPath, info, this.shouldConnect());
  }

  private watch(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const current = new Set(folders.map((f) => f.uri.toString()));
    for (const [key, w] of this.watchers) {
      if (!current.has(key)) {
        w.dispose();
        this.watchers.delete(key);
      }
    }
    for (const folder of folders) {
      const key = folder.uri.toString();
      if (this.watchers.has(key)) continue;
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, DEV_JSON_GLOB));
      w.onDidCreate((u) => void this.load(u));
      w.onDidChange((u) => void this.load(u));
      w.onDidDelete((u) => this.bridge.remove(u.fsPath));
      this.watchers.set(key, w);
    }
  }

  dispose(): void {
    this.bridge.dispose();
    this.watchers.forEach((w) => w.dispose());
    this.subs.forEach((s) => s.dispose());
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
