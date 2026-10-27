// The hosted IDE protocol, without vscode. docs/ide-bridge.md describes it; anything not named here is ignored.

import * as path from 'node:path';

/** Additive: a newer server keeps answering this one. */
export const PROTOCOL = 2;
/** A server with a higher major needs a newer extension. */
export const MAJOR = 1;
/** What this extension handles: the events it takes, `lsp` for a language client, `widget` for data-driven segment editors. */
export const CAPABILITIES = ['ready', 'boards', 'scopes', 'scope', 'select', 'log', 'lsp', 'widget'] as const;

export interface Envelope {
  event: string;
  data: any;
}

export interface Hello {
  name: string;
  version: string;
  protocol: number;
  major: number;
  capabilities: string[];
}

export const hello = (name: string, version: string): Hello => ({ name, version, protocol: PROTOCOL, major: MAJOR, capabilities: [...CAPABILITIES] });

export interface ReadyInfo {
  port: number;
  host: string;
  urls: string[];
  root: string;
  pid: number;
  version: string;
  /** a workspace server's folders, `root` first */
  folders?: string[];
  /** absent before protocol 2 */
  protocol?: number;
  major?: number;
  capabilities?: string[];
}

// Only the fields the extension reads; the server sends more.

export interface BoardsInfo {
  boards: { name: string; title: string; entry: string; status?: string; targets?: string[] }[];
  /** the directory entries are relative to */
  root?: string;
}

export interface ScopeInfo {
  scope: string;
  root: string;
  route: string;
  /** null before the server listens */
  url: string | null;
}

export interface ScopesInfo {
  scopes: { root: string; slug?: string; name?: string; route?: string; status?: string; displayed?: boolean }[];
  displayed?: string;
  single?: boolean;
}

/** 1-based, `endCol` inclusive. */
export interface SelectRequest {
  file: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

export interface LogEvent {
  level: string;
  text: string;
}

export const EVENTS = {
  ready: 'pcbjs:ide:ready',
  boards: 'pcbjs:ide:boards',
  scopes: 'pcbjs:ide:scopes',
  scope: 'pcbjs:ide:scope',
  select: 'pcbjs:ide:select',
  log: 'pcbjs:ide:log',
  hello: 'pcbjs:ide:hello',
  cursor: 'pcbjs:ide:cursor',
  focus: 'pcbjs:ide:focus',
  close: 'pcbjs:ide:close',
  bye: 'pcbjs:ide:bye',
} as const;

/** The server's protocol major, 1 for a server from before protocol 2. */
export const majorOf = (info: { major?: unknown }): number => (Number.isInteger(info.major) ? (info.major as number) : 1);

/** Whether the server offers a capability; a server from before protocol 2 lists none and offers all of protocol 1. */
export const offers = (info: { capabilities?: unknown }, cap: string): boolean => !Array.isArray(info.capabilities) || info.capabilities.includes(cap);

/** The notice for a server too new for this extension, undefined when it is not. */
export function tooNew(info: { major?: unknown; version?: unknown; root?: unknown }): string | undefined {
  const major = majorOf(info);
  if (major <= MAJOR) return undefined;
  return `pcbjs ${String(info.version ?? '')} in ${String(info.root ?? 'this project')} speaks IDE protocol ${major}, this extension ${MAJOR}. Run \`pcbjs ide install\` in the project to install the extension that matches it.`;
}

export function encode(event: string, data?: unknown): string {
  return JSON.stringify(data === undefined ? { event } : { event, data });
}

const frameText = (raw: unknown): string =>
  typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : raw instanceof ArrayBuffer ? Buffer.from(raw).toString('utf8') : String(raw);

/** A JSON-RPC message of the language server, undefined for anything else. */
export function parseRpc(raw: unknown): object | undefined {
  let text: string;
  try {
    text = frameText(raw);
  } catch {
    return undefined;
  }
  if (!text.includes('"jsonrpc"')) return undefined;
  try {
    const msg = JSON.parse(text);
    return msg && typeof msg === 'object' && !Array.isArray(msg) && msg.jsonrpc === '2.0' ? msg : undefined;
  } catch {
    return undefined;
  }
}

export function parseEnvelope(raw: unknown): Envelope | undefined {
  let msg: any;
  try {
    msg = JSON.parse(frameText(raw));
  } catch {
    return undefined;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.event !== 'string' || !msg.event) return undefined;
  return { event: msg.event, data: msg.data };
}

export function validSelect(d: any): d is SelectRequest {
  return !!d && typeof d.file === 'string' && [d.line, d.col, d.endLine, d.endCol].every((n) => Number.isInteger(n) && n >= 1);
}

export function validReady(d: any): d is ReadyInfo {
  return !!d && typeof d.root === 'string' && Number.isInteger(d.port) && d.port > 0;
}

export function validBoards(d: any): d is BoardsInfo {
  return !!d && Array.isArray(d.boards);
}

/** True when `file` lies strictly inside `root`. */
export function isUnder(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function samePath(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return process.platform === 'win32' || process.platform === 'darwin' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/** The first loopback URL, else the first URL, else host and port. */
export function devUrl(info: ReadyInfo): string {
  const urls = Array.isArray(info.urls) ? info.urls.filter((u) => typeof u === 'string') : [];
  const loop = urls.find((u) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(u));
  if (loop ?? urls[0]) return (loop ?? urls[0]) as string;
  let host = info.host || '127.0.0.1';
  if (host === '0.0.0.0' || host === '::') host = '127.0.0.1';
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  return `http://${host}:${info.port}/`;
}

export type ThemeName = 'dark' | 'light' | 'hc';

/** vscode.ColorThemeKind: 1 Light, 2 Dark, 3 HighContrast, 4 HighContrastLight. */
export function themeName(kind: number): ThemeName {
  return kind === 1 ? 'light' : kind === 3 || kind === 4 ? 'hc' : 'dark';
}

export type ViewKind = '2d' | '3d' | 'sch';

/** With a view: that view, and `panel=0` since the sidebar shows findings, nets and BOM. */
export function viewerUrl(url: string, theme: ThemeName, view?: ViewKind): string {
  const u = new URL(url);
  u.searchParams.set('ide', '1');
  u.searchParams.set('theme', theme);
  if (view) {
    u.searchParams.set('view', view);
    u.searchParams.set('panel', '0');
  }
  return u.toString();
}
