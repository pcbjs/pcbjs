// LSP over the boards the dev server compiled; it never compiles, the dev server calls refresh() after each compile.

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { MessageReader, MessageWriter } from 'vscode-jsonrpc';
import { createConnection as createCommonConnection } from 'vscode-languageserver/lib/common/server.js';
import { createProtocolConnection, type CodeLens, type Diagnostic, type DocumentHighlight, type Hover, type InitializeParams, type InlayHint, type Location } from 'vscode-languageserver/node.js';
import type { RouteInfo, SiteData, SiteFootprint, SiteItem, SourceRange } from '@pcbjs/core/site-data';
import { callSpans, detect, routeCalls, type Hit } from './detect.js';
import { innermost, segmentsOf, typedSegment, type RawSegment, type SegmentContext } from './segments.js';
import { forClient, METHODS, negotiate, widgetOf, type ClientHello, type FocusParams, type Position, type PreviewParams, type Range, type Segment, type SegmentsParams, type ServerHello } from './protocol.js';
import { summary } from './describe.js';
import { hoverPreview, imageMarkdown, targetPreview, type HoverPreview } from './hover-preview.js';
import { projects, type Inject } from './project.js';
import { padSource, targetAt, type Target } from './target.js';
import { renderPreview } from './preview.js';
import { formatNum } from './values.js';

/** One compiled board, or one target of it, with the project root its paths are relative to. */
export interface BoardRef {
  root: string;
  site: SiteData;
}

/** What the dev server gives the language server. */
export interface Provider {
  /** the pcbjs version, for the handshake */
  version: string;
  /** every board the server holds now, each target of each, of every loaded project */
  boards(): BoardRef[];
  /** the page a preview should show now, sent after the handshake */
  preview?(): PreviewParams | null;
  /** the editor focused a file, absolute */
  focus?(file: string): void;
  /** the editor cursor, 1-based, and what the code under it names on the boards */
  cursor?(file: string, line: number, col: number, target?: CursorTarget): void;
  /** what the type checker reads instead of a file's text, such as the names a schematic namespace brings into scope */
  inject?: Inject;
  /** the editor closed a file */
  close?(file: string): void;
  /** an open document's text, null once it is saved or closed and the disk copy rules again */
  draft?(file: string, text: string | null): void;
  /** the spans a draft preview skipped, per file */
  skipped?(): { file: string; ranges: Range[] }[];
  log?(message: string): void;
}

export interface SelectRange { file: string; line: number; col: number; endLine: number; endCol: number }

/** What `pcbjs:cursor` carries for the viewers: the kind and, per board, what to highlight. */
export type CursorTarget = Pick<Target, 'kind' | 'boards'>;

export interface LanguageServer {
  /** true once the client completed `initialize` */
  readonly initialized: boolean;
  /** what the handshake agreed, null before it */
  readonly hello: ServerHello | null;
  /** the client said it speaks the pcbjs messages */
  readonly pcbjsClient: boolean;
  /** send `pcbjs/select`; false when the client cannot take it */
  select(sel: SelectRange): boolean;
  /** send `pcbjs/preview` */
  preview(p: PreviewParams): boolean;
  /** where the code connects a pad, for a click on it in a viewer */
  padSource(board: string, ref: string, num: string): SelectRange | undefined;
  /** the boards changed: publish the findings again and ask the client to refresh lenses and hints */
  refresh(): void;
  dispose(): void;
}

const DIAG_ERROR = 1;
const DIAG_WARNING = 2;
const DIAG_INFO = 3;
const DIAG_HINT = 4;
const TAG_UNNECESSARY = 1;
const HL_TEXT = 1;
const HL_READ = 2;
const HINT_TYPE = 1;

/** A file URI from a path and back, as editors write them. */
export const toUri = (file: string) => pathToFileURL(file).href;
export function toFile(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/** Start a server on a reader and writer, such as those of messageChannel(). */
export function startLanguageServer(transport: { reader: MessageReader; writer: MessageWriter }, provider: Provider): LanguageServer {
  let disposed = false;
  let shutdown = false;
  const watchDog = {
    initialize: () => undefined,
    get shutdownReceived() { return shutdown; },
    set shutdownReceived(v: boolean) { shutdown = v; },
    // never process.exit: the dev server outlives its editors
    exit: () => dispose(),
  };
  const connection = createCommonConnection((logger) => createProtocolConnection(transport.reader, transport.writer, logger), watchDog);

  const docs = new Map<string, { text: string; version: number }>();
  let hello: ServerHello | null = null;
  let pcbjsClient = false;
  let initialized = false;
  let caps: InitializeParams['capabilities'] = {};
  let published = new Set<string>();
  let lastFocus: string | undefined;
  const code = projects({ get: (f) => docs.get(toUri(f)) }, provider.inject);

  const draft = (uri: string, text: string | null) => {
    const f = toFile(uri);
    if (f) provider.draft?.(f, text);
  };
  connection.onDidOpenTextDocument((p) => {
    docs.set(p.textDocument.uri, { text: p.textDocument.text, version: p.textDocument.version });
    draft(p.textDocument.uri, p.textDocument.text);
  });
  connection.onDidChangeTextDocument((p) => {
    const last = p.contentChanges[p.contentChanges.length - 1];
    if (!last || ('range' in last && last.range)) return;
    docs.set(p.textDocument.uri, { text: last.text, version: p.textDocument.version });
    draft(p.textDocument.uri, last.text);
  });
  connection.onDidSaveTextDocument((p) => draft(p.textDocument.uri, null));
  connection.onDidCloseTextDocument((p) => {
    docs.delete(p.textDocument.uri);
    draft(p.textDocument.uri, null);
    const f = toFile(p.textDocument.uri);
    if (f) provider.close?.(f);
  });

  connection.onInitialize((params) => {
    caps = params.capabilities ?? {};
    const opts = (params.initializationOptions ?? {}) as { pcbjs?: ClientHello };
    pcbjsClient = !!opts.pcbjs && typeof opts.pcbjs === 'object';
    hello = negotiate(pcbjsClient ? opts.pcbjs : undefined, provider.version);
    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
        hoverProvider: true,
        definitionProvider: true,
        documentHighlightProvider: true,
        codeLensProvider: { resolveProvider: false },
        inlayHintProvider: true,
        experimental: { pcbjs: hello },
      },
      serverInfo: { name: 'pcbjs', version: provider.version },
    };
  });
  connection.onInitialized(() => {
    initialized = true;
    publish();
    const p = provider.preview?.();
    if (p) sendPreview(p);
  });

  const lines = (text: string) => {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
  };
  const offsetAt = (text: string, p: Position) => {
    const ls = lines(text);
    const line = Math.min(Math.max(p.line, 0), ls.length - 1);
    return Math.min(ls[line] + Math.max(p.character, 0), line + 1 < ls.length ? ls[line + 1] : text.length);
  };
  const positionAt = (ls: number[], offset: number): Position => {
    let lo = 0, hi = ls.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ls[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: offset - ls[lo] };
  };

  interface Facts { file: string; boards: { ref: BoardRef; rel: string; ranges: SourceRange[] }[]; all: BoardRef[] }
  /** The boards whose root holds a file or that drew from it outside their root, keyed `../lib/wire.ts`; every board when none does. */
  const facts = (file: string): Facts => {
    const all = provider.boards();
    const boards: Facts['boards'] = [];
    const owners: BoardRef[] = [];
    for (const ref of all) {
      const rel = keyOf(ref.root, file);
      if (rel === undefined) continue;
      const ranges = ref.site.sources?.[rel];
      const outside = rel.startsWith('../');
      if (!outside || ranges?.length || (ref.site.routes ?? []).some((r) => (r.call && sameFile(ref.root, r.call.file, file)) || r.src?.file === rel)) owners.push(ref);
      if (ranges?.length) boards.push({ ref, rel, ranges });
    }
    return { file, boards, all: owners.length ? owners : all };
  };
  const segmentContext = (f: Facts, text?: string): SegmentContext => {
    const sites = (f.boards.length ? f.boards.map((b) => b.ref) : f.all);
    const layers = [...new Set(sites.flatMap((s) => s.site.layers.map((l) => l.name)))];
    return {
      layers: layers.length ? layers : undefined,
      pads: (ref) => {
        const hit = partsNamed(sites, ref)[0];
        return hit?.fp.pads.map((p) => ({ num: p.num, name: p.name, net: p.net }));
      },
      routeHelpers: text === undefined ? undefined : helpersIn(f, text),
    };
  };
  /** Every footprint the code may mean by a part name, on the given boards, see partsNamed. */
  const partsOf = (f: Facts, name: string) => partsNamed(f.all, name);
  /** The routes whose helper was called in this file, each with the offset of its call site in the text. */
  const callRoutes = (f: Facts, text: string): { route: RouteInfo; at: number; key: string }[] => {
    const ls = lines(text);
    const out: { route: RouteInfo; at: number; key: string }[] = [];
    const seen = new Set<string>();
    for (const b of f.all) for (const r of b.site.routes ?? []) {
      if (!r.call || !sameFile(b.root, r.call.file, f.file)) continue;
      const id = `${b.site.name}|${r.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const line = Math.min(Math.max(r.call.line - 1, 0), ls.length - 1);
      out.push({ route: r, at: ls[line] + Math.max(r.call.col - 1, 0), key: `${r.call.line}:${r.call.col}` });
    }
    return out;
  };
  /** The names of the functions called in this file that made routes: `chain` in `chain(SIG, J1[3], U2.IN)`. */
  const helpersIn = (f: Facts, text: string): Set<string> => {
    const out = new Set<string>();
    for (const c of callRoutes(f, text)) {
      const m = /[A-Za-z_$][\w$]*/y;
      m.lastIndex = c.at;
      const w = m.exec(text)?.[0];
      if (w) out.add(w);
    }
    return out;
  };
  /** The routes a helper call around an offset made: those of the innermost call expression that holds a call site. */
  const routesOfCall = (f: Facts, text: string, offset: number): RouteInfo[] => {
    const routes = callRoutes(f, text);
    if (!routes.length) return [];
    let spans: { start: number; end: number }[] = [];
    try {
      spans = callSpans(text, f.file);
    } catch {}
    spans = spans.filter((sp) => sp.start <= offset && offset <= sp.end).sort((a, b) => a.end - a.start - (b.end - b.start));
    for (const sp of spans) {
      const rs = routes.filter((r) => r.at >= sp.start && r.at < sp.end).map((r) => r.route);
      if (rs.length) return rs;
    }
    return [];
  };
  const itemIndex = new WeakMap<SiteData, Map<number, SiteItem>>();
  const itemsOf = (site: SiteData) => {
    let m = itemIndex.get(site);
    if (!m) itemIndex.set(site, (m = new Map((site.items ?? []).map((it) => [it.id, it]))));
    return m;
  };
  /** The innermost source range at a position, 1-based compare, in the first board that has one. */
  const rangeAt = (f: Facts, p: Position): { ref: BoardRef; range: SourceRange; ranges: SourceRange[] } | undefined => {
    const line = p.line + 1, col = p.character + 1;
    let best: { ref: BoardRef; range: SourceRange; ranges: SourceRange[] } | undefined;
    const size = (r: SourceRange) => (r.end[0] - r.start[0]) * 1e6 + (r.end[1] - r.start[1]);
    for (const b of f.boards) for (const r of b.ranges) {
      if (before([line, col], r.start) || before(r.end, [line, col - 1])) continue;
      if (!best || size(r) < size(best.range)) best = { ref: b.ref, range: r, ranges: b.ranges };
    }
    return best;
  };
  const docText = (uri: string) => docs.get(uri)?.text;
  /** What the innermost token at a position names on the boards, by its declaration and type. */
  const targetOf = (f: Facts, text: string, p: Position): Target | undefined => {
    try {
      const program = code.program(f.file);
      const t = program && targetAt(program, f.file, code.toService(f.file, offsetAt(text, p)), f.all);
      return t && { ...t, start: code.fromService(f.file, t.start), end: code.fromService(f.file, t.end) };
    } catch {
      return undefined;
    }
  };
  const fileOf = (uri: string) => toFile(uri);

  connection.onDocumentHighlight((p): DocumentHighlight[] => {
    const file = fileOf(p.textDocument.uri);
    if (!file) return [];
    const f = facts(file);
    const at = rangeAt(f, p.position);
    if (!at) return [];
    const out: DocumentHighlight[] = [{ range: lspRange(at.range), kind: HL_TEXT }];
    const ids = new Set(at.range.ids);
    const refs = new Set(at.range.refs);
    for (const r of at.ranges) {
      if (r === at.range || contains(r, at.range) || contains(at.range, r)) continue;
      if (r.ids.some((i) => ids.has(i)) || r.refs.some((x) => refs.has(x))) out.push({ range: lspRange(r), kind: HL_READ });
    }
    return out;
  });

  connection.onHover((p): Hover | null => {
    const file = fileOf(p.textDocument.uri);
    if (!file) return null;
    const f = facts(file);
    const parts: string[] = [];
    const text = docText(p.textDocument.uri);
    let hitRange: Range | undefined;
    let hit: Hit | undefined;
    const target = text === undefined ? undefined : targetOf(f, text, p.position);
    if (text !== undefined) {
      const off = offsetAt(text, p.position);
      hit = innermost(safeDetect(text, file), off);
      if (hit) {
        const ls = lines(text);
        hitRange = { start: positionAt(ls, hit.start), end: positionAt(ls, hit.end) };
        parts.push(`**pcbjs ${hit.kind}** of \`${hit.context.owner}\` \`${hit.context.prop}\`${hit.context.chain ? ', a builder method' : ''}: ${summary(hit)}${pinNet(hit, f)}`);
      }
    }
    const at = rangeAt(f, p.position);
    if (at) parts.push(drew(at.ref.site, at.range, f.boards.length > 1 ? f.boards.map((b) => b.ref.site) : undefined));
    let routes: RouteInfo[] = [];
    if (at) {
      // a layout placed several times made one route per instance at the same call
      const rel = keyOf(at.ref.root, file)!;
      const line = p.position.line + 1, col = p.position.character + 1;
      const around = at.ranges.filter((r) => !before([line, col], r.start) && !before(r.end, [line, col - 1])).sort((a, b) => (before(a.start, b.start) ? 1 : -1));
      routes = around.map((r) => routesAt(f, rel, r.start)).find((x) => x.length) ?? [];
      const found = around.map((r) => findingsAt(f, file, r.start)).find((x) => x.length) ?? [];
      if (routes.length) parts.push(routesText(routes));
      if (found.length) parts.push(found.map((m) => `- ${m.severity} ${m.rule}: ${m.message}`).join('\n'));
    }
    if (!routes.length && text !== undefined) {
      const made = routesOfCall(f, text, offsetAt(text, p.position));
      if (made.length) parts.push(`made by this call: ${routesText(made)}`);
      routes = made;
    }
    // a model path keeps its own image: the target around it is only the part it belongs to
    const own = previewOf(f, file, text, p.position, hit, at, routes);
    const image = own?.kind === 'model' ? own : (target && targetPreview(target, f.all)) ?? own;
    if (target && text !== undefined && own?.kind !== 'model') { const ls = lines(text); hitRange = { start: positionAt(ls, target.start), end: positionAt(ls, target.end) }; }
    if (image) parts.unshift(imageMarkdown(image, `${image.kind} on ${image.board}`), ...image.lines, ...(image.note ? [`_${image.note}_`] : []));
    if (!parts.length) return null;
    return { contents: { kind: 'markdown', value: parts.join('\n\n') }, ...(hitRange ? { range: hitRange } : at ? { range: lspRange(at.range) } : {}) };
  });

  /** The hover's image: the item under the cursor, else the routes a helper call made there. */
  const previewOf = (f: Facts, file: string, text: string | undefined, pos: Position, hit: Hit | undefined, at: ReturnType<typeof rangeAt>, routes: RouteInfo[]): HoverPreview | undefined => {
    try {
      const got = hoverPreview({ file, text, offset: text === undefined ? undefined : offsetAt(text, pos), hit, at: at && { ref: at.ref, range: at.range }, boards: f.all, parts: (n) => partsOf(f, n) });
      if (got || !routes.length) return got;
      for (const b of f.all) {
        // the range of a route call in a helper holds every call's items: those of the routes' nets and pairs
        const nets = new Set(routes.map((r) => r.net)), pairs = new Set(routes.flatMap((r) => (r.pair ? [r.pair] : [])));
        const items = itemsOf(b.site);
        const ids = routes.flatMap((r) => (r.src ? b.site.sources?.[r.src.file]?.find((x) => x.start[0] === r.src!.line && x.start[1] === r.src!.col)?.ids ?? [] : []))
          .filter((i) => { const it = items.get(i); return !!it && ((it.net !== undefined && nets.has(it.net)) || (it.pair !== undefined && pairs.has(it.pair))); });
        const preview = ids.length ? renderPreview(b.site, { ids }) : undefined;
        if (preview) return { kind: 'items', preview, board: b.site.name, lines: [] };
      }
    } catch {}
    return undefined;
  };

  connection.onDefinition((p): Location[] => {
    const file = fileOf(p.textDocument.uri);
    if (!file) return [];
    const f = facts(file);
    const out: Location[] = [];
    const text = docText(p.textDocument.uri);
    // a pad reference goes to the placement of its part; inside a layout placed several times, to every instance's
    if (text !== undefined) {
      const hit = innermost(safeDetect(text, file, helpersIn(f, text)), offsetAt(text, p.position));
      if (hit?.kind === 'pinRef') {
        const locs = partsOf(f, hit.context.ref ?? '').flatMap(({ fp }) => (fp.src ? [location(fp.src.abs, fp.src)] : []));
        if (locs.length) return dedupeLocations(locs);
      }
    }
    const at = rangeAt(f, p.position);
    if (!at) return out;
    const [line, col] = at.range.start;
    for (const ref of at.range.refs) {
      const fp = at.ref.site.footprints.find((x) => x.ref === ref);
      if (!fp?.src) continue;
      const atPlacement = keyOf(at.ref.root, file) === fp.src.file && fp.src.line === line && fp.src.col === col;
      // the placement leads to the definition, anything else inside the footprint to the placement
      if (atPlacement && fp.def) out.push(location(fp.def.abs, fp.def));
      else if (!atPlacement) out.push(location(fp.src.abs, fp.src));
    }
    return dedupeLocations(out);
  });

  connection.onCodeLens((p): CodeLens[] => {
    const file = fileOf(p.textDocument.uri);
    if (!file) return [];
    const f = facts(file);
    const out: CodeLens[] = [];
    const groups = new Map<string, { line: number; col: number; routes: RouteInfo[]; ids: Set<string> }>();
    const put = (key: string, line: number, col: number, site: string, r: RouteInfo) => {
      const g = groups.get(key) ?? { line, col, routes: [], ids: new Set<string>() };
      groups.set(key, g);
      if (g.ids.has(`${site}|${r.id}`)) return;
      g.ids.add(`${site}|${r.id}`);
      g.routes.push(r);
    };
    for (const ref of f.all) {
      const rel = keyOf(ref.root, file);
      if (rel === undefined) continue;
      for (const r of ref.site.routes ?? []) {
        if (r.src && r.src.file === rel) put(`src ${r.src.line}:${r.src.col}`, r.src.line, r.src.col, ref.site.name, r);
        if (r.call && sameFile(ref.root, r.call.file, file)) put(`call ${r.call.line}:${r.call.col}`, r.call.line, r.call.col, ref.site.name, r);
      }
    }
    for (const g of groups.values()) out.push(lens(g.line, g.col, routesTitle(g.routes)));
    const lensed = new Set<string>();
    for (const b of f.boards) {
      const paths = partPaths(b.ref.site);
      for (const r of b.ranges) {
        const k = `${r.start[0]}:${r.start[1]}`;
        if (r.refs.length < 2 || lensed.has(k)) continue;
        const own = r.refs.map((x) => paths.get(x));
        if (own.some((x) => !x) || new Set(own.map((x) => x!.local)).size !== 1) continue;
        lensed.add(k);
        out.push(lens(r.start[0], r.start[1], instancesText(r.refs, paths)));
      }
    }
    const found = new Map<string, { line: number; col: number; markers: Marker[] }>();
    for (const m of markers(f.all)) {
      if (m.file !== file) continue;
      const k = `${m.line}:${m.col}`;
      const g = found.get(k) ?? { line: m.line, col: m.col, markers: [] };
      g.markers.push(m);
      found.set(k, g);
    }
    for (const g of found.values()) out.push(lens(g.line, g.col, findingsTitle(g.markers)));
    return out;
  });

  connection.onRequest('textDocument/inlayHint', (p: { textDocument: { uri: string }; range: Range }): InlayHint[] => {
    const file = fileOf(p.textDocument.uri);
    const text = docText(p.textDocument.uri);
    if (!file || text === undefined) return [];
    const f = facts(file);
    const ls = lines(text);
    const from = offsetAt(text, p.range.start);
    const to = offsetAt(text, p.range.end);
    const out: InlayHint[] = [];
    for (const hit of safeDetect(text, file, helpersIn(f, text))) {
      if (hit.kind !== 'pinRef' || hit.end < from || hit.start > to) continue;
      const nets = padNets(f, hit);
      if (nets === undefined) continue;
      out.push({ position: positionAt(ls, hit.end + 1), label: netLabel(nets), kind: HINT_TYPE, paddingLeft: true });
    }
    let calls: ReturnType<typeof routeCalls> = [];
    try {
      calls = routeCalls(text, file);
    } catch {}
    for (const c of calls) {
      if (c.hasWidth || c.chainEnd < from || c.start > to) continue;
      const pos = positionAt(ls, c.start);
      const widths = new Set<number>();
      for (const b of f.boards) {
        const r = b.ranges.find((x) => x.start[0] === pos.line + 1 && x.start[1] === pos.character + 1 && !x.seg);
        if (!r) continue;
        const items = itemsOf(b.ref.site);
        for (const id of r.ids) {
          const it = items.get(id);
          if (it?.kind === 'track' && it.width !== undefined) widths.add(Math.round(it.width * 1e4) / 1e4);
        }
      }
      if (!widths.size) continue;
      out.push({ position: positionAt(ls, c.chainEnd), label: `width ${[...widths].sort((a, b) => a - b).map((w) => formatNum(w)).join(', ')} mm`, kind: HINT_TYPE, paddingLeft: true });
    }
    return out;
  });

  connection.onNotification(METHODS.focus, (p: FocusParams) => {
    const file = p?.textDocument?.uri ? fileOf(p.textDocument.uri) : undefined;
    if (!file) return;
    if (file !== lastFocus) {
      lastFocus = file;
      provider.focus?.(file);
    }
    if (!p.position) return;
    const text = docText(p.textDocument.uri);
    const t = text === undefined ? undefined : targetOf(facts(file), text, p.position);
    provider.cursor?.(file, p.position.line + 1, p.position.character + 1, t && { kind: t.kind, boards: t.boards });
  });

  connection.onRequest(METHODS.segments, (p: SegmentsParams): Segment[] => {
    const uri = p?.textDocument?.uri;
    const file = uri ? fileOf(uri) : undefined;
    const text = uri ? docText(uri) : undefined;
    if (!file || text === undefined || !hello) return [];
    const ctx = segmentContext(facts(file), text);
    const ls = lines(text);
    const toSeg = (s: RawSegment): Segment | undefined => forClient({
      range: { start: positionAt(ls, s.start), end: positionAt(ls, s.end) },
      kind: s.kind, value: s.value, label: s.label, constraints: s.constraints, widget: widgetOf(s.kind, s.constraints),
      presentations: s.presentations.map((x) => ({ label: x.label, ...(x.detail ? { detail: x.detail } : {}), edit: { range: { start: positionAt(ls, x.edit.start), end: positionAt(ls, x.edit.end) }, newText: x.edit.newText } })),
      ...(s.error ? { error: s.error } : {}),
    }, hello!.kinds);
    if (p.position && typeof p.value === 'string') {
      const s = typedSegment(text, file, ctx, offsetAt(text, p.position), p.value);
      const seg = s && toSeg(s);
      return seg ? [seg] : [];
    }
    let segs = segmentsOf(text, file, ctx);
    if (p.position) {
      const one = innermost(segs, offsetAt(text, p.position));
      segs = one ? [one] : [];
    } else if (p.range) {
      const a = offsetAt(text, p.range.start), b = offsetAt(text, p.range.end);
      segs = segs.filter((s) => s.end >= a && s.start <= b);
    }
    return segs.map(toSeg).filter((s): s is Segment => !!s);
  });

  interface Marker { file: string; line: number; col: number; endLine?: number; endCol?: number; severity: 'error' | 'warning' | 'info'; rule: string; message: string; kind: 'DRC' | 'ERC'; target?: string }
  function markers(refs: BoardRef[]): Marker[] {
    const out: Marker[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      for (const [kind, list] of [['DRC', ref.site.drc ?? []], ['ERC', ref.site.erc ?? []]] as const) {
        for (const m of list) {
          if (!m.src?.file) continue;
          const file = isAbsolute(m.src.file) ? m.src.file : resolve(ref.root, m.src.file);
          const key = `${file}|${m.src.line}|${m.src.col}|${m.rule}|${m.message}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const rel = keyOf(ref.root, file);
          const r = rel !== undefined ? ref.site.sources?.[rel]?.find((x) => x.start[0] === m.src!.line && x.start[1] === m.src!.col) : undefined;
          const src = m.src as { endLine?: number; endCol?: number };
          out.push({ file, line: m.src.line, col: m.src.col, endLine: src.endLine ?? r?.end[0], endCol: src.endCol ?? r?.end[1], severity: m.severity, rule: m.rule, message: m.message, kind, target: ref.site.variant?.name });
        }
      }
    }
    return out;
  }
  function publish(): void {
    if (!initialized || disposed) return;
    const byFile = new Map<string, Diagnostic[]>();
    for (const m of markers(provider.boards())) {
      const uri = toUri(m.file);
      const list = byFile.get(uri) ?? [];
      const start = { line: m.line - 1, character: m.col - 1 };
      // only the first line of a long range, so a finding on a whole element does not paint it all
      const end = m.endLine === m.line && m.endCol !== undefined ? { line: m.line - 1, character: m.endCol } : start;
      list.push({ range: { start, end }, severity: m.severity === 'error' ? DIAG_ERROR : m.severity === 'info' ? DIAG_INFO : DIAG_WARNING, source: `pcbjs ${m.kind}`, code: m.rule, message: m.target ? `${m.message} (${m.target})` : m.message });
      byFile.set(uri, list);
    }
    for (const s of provider.skipped?.() ?? []) {
      const uri = toUri(s.file);
      const list = byFile.get(uri) ?? [];
      for (const range of s.ranges) list.push({ range, severity: DIAG_HINT, tags: [TAG_UNNECESSARY], source: 'pcbjs draft', message: 'skipped in the preview: a syntax error' });
      byFile.set(uri, list);
    }
    for (const uri of published) if (!byFile.has(uri)) void connection.sendDiagnostics({ uri, diagnostics: [] }).catch(() => undefined);
    for (const [uri, diagnostics] of byFile) void connection.sendDiagnostics({ uri, diagnostics }).catch(() => undefined);
    published = new Set(byFile.keys());
  }

  function routesAt(f: Facts, rel: string, start: [number, number]) {
    const out: RouteInfo[] = [];
    const seen = new Set<string>();
    for (const b of f.all) for (const r of b.site.routes ?? []) {
      if (!r.src || r.src.file !== rel || r.src.line !== start[0] || r.src.col !== start[1] || seen.has(`${b.site.name}|${r.id}`)) continue;
      seen.add(`${b.site.name}|${r.id}`);
      out.push(r);
    }
    return out;
  }
  function findingsAt(f: Facts, file: string, start: [number, number]): Marker[] {
    return markers(f.all).filter((m) => m.file === file && m.line === start[0] && m.col === start[1]);
  }
  /** The net of the pad a reference names, one per part it may mean: one per instance of a layout placed several times. */
  function padNets(f: Facts, hit: Hit): (string | null)[] | undefined {
    const ref = hit.context.ref ?? '';
    const num = hit.context.form === 'dotted' ? hit.value.slice(ref.length + 1) : hit.value;
    const out: (string | null)[] = [];
    for (const { fp } of partsOf(f, ref)) {
      const pad = fp.pads.find((p) => p.num === num) ?? fp.pads.find((p) => p.name === num);
      if (pad) out.push(pad.net ?? null);
    }
    return out.length ? out : undefined;
  }
  function pinNet(hit: Hit, f: Facts): string {
    if (hit.kind !== 'pinRef') return '';
    const n = padNets(f, hit);
    return n === undefined ? '' : `, ${netLabel(n)}`;
  }

  function sendPreview(p: PreviewParams): boolean {
    if (!initialized || !pcbjsClient || disposed) return false;
    void connection.sendNotification(METHODS.preview, p).catch(() => undefined);
    return true;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    code.dispose();
    try {
      connection.dispose();
    } catch {}
  }

  connection.listen();

  return {
    get initialized() { return initialized && !disposed; },
    get hello() { return hello; },
    get pcbjsClient() { return pcbjsClient; },
    select(sel) {
      if (!initialized || !pcbjsClient || disposed) return false;
      const range: Range = { start: { line: sel.line - 1, character: sel.col - 1 }, end: { line: sel.endLine - 1, character: sel.endCol } };
      void connection.sendNotification(METHODS.select, { uri: toUri(sel.file), range }).catch(() => undefined);
      return true;
    },
    preview: sendPreview,
    padSource(board, ref, num) {
      const b = provider.boards().find((x) => x.site.name === board) ?? provider.boards().find((x) => x.site.footprints.some((fp) => fp.ref === ref));
      const s = b && padSource((f) => code.service(f), b, ref, num);
      if (!s) return undefined;
      const text = docs.get(toUri(s.file))?.text ?? readText(s.file);
      if (text === undefined) return undefined;
      const ls = lines(text);
      const a = positionAt(ls, code.fromService(s.file, s.start)), e = positionAt(ls, code.fromService(s.file, s.end) - 1);
      return { file: s.file, line: a.line + 1, col: a.character + 1, endLine: e.line + 1, endCol: e.character + 1 };
    },
    refresh() {
      if (!initialized || disposed) return;
      publish();
      if (caps.workspace?.codeLens?.refreshSupport) void connection.sendRequest('workspace/codeLens/refresh').catch(() => undefined);
      if (caps.workspace?.inlayHint?.refreshSupport) void connection.sendRequest('workspace/inlayHint/refresh').catch(() => undefined);
    },
    dispose,
  };
}

function safeDetect(text: string, file: string, routeHelpers?: ReadonlySet<string>): Hit[] {
  try {
    return detect(text, file, { routeHelpers });
  } catch {
    return [];
  }
}

/** `file` relative to `root` with forward slashes as the source index keys it, `../lib/wire.ts` outside; undefined on another drive. */
function keyOf(root: string, file: string): string | undefined {
  const rel = relative(root, file);
  if (!rel || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}

/** Whether a source path of a board, relative to its root or absolute, names `file`. */
const sameFile = (root: string, src: string, file: string) => (isAbsolute(src) ? src : resolve(root, src)) === file;

/** A part's instance path and its key in the instance, `A` and `QH` for Q1 of A, by ref; parts at the board level are absent. */
function partPaths(site: SiteData): Map<string, { path: string; local: string }> {
  const out = new Map<string, { path: string; local: string }>();
  for (const p of site.schematic?.parts ?? []) if (p.path?.length) out.set(p.ref, { path: p.path.join('/'), local: p.local ?? p.ref });
  return out;
}

const partText = (ref: string, paths: Map<string, { path: string; local: string }>) => { const p = paths.get(ref); return p ? `${ref} (${p.path}/${p.local})` : ref; };

function instancesText(refs: string[], paths: Map<string, { path: string; local: string }>): string {
  const sorted = [...refs].sort((a, b) => (paths.get(a)?.path ?? '').localeCompare(paths.get(b)?.path ?? '', undefined, { numeric: true }));
  return `${refs.length} instances: ${sorted.slice(0, 8).map((r) => partText(r, paths)).join(' · ')}${refs.length > 8 ? ' · ...' : ''}`;
}

const netLabel = (nets: (string | null)[]): string => {
  const u = [...new Set(nets.map((n) => n ?? 'no net'))];
  return u.length === 1 ? (u[0] === 'no net' ? 'no net' : `net ${u[0]}`) : `nets ${u.join(', ')}`;
};

const readText = (file: string) => { try { return readFileSync(file, 'utf8'); } catch { return undefined; } };

const declCache = new Map<string, { stamp: string; lines: string[] }>();
/** A line of a declaration file by real path, the file read once per modification. */
function declLine(file: string, line: number): string | undefined {
  let stamp: string;
  try { const st = statSync(file); stamp = `${st.size}:${st.mtimeMs}`; } catch { return undefined; }
  let e = declCache.get(file);
  if (!e || e.stamp !== stamp) {
    try { e = { stamp, lines: readFileSync(file, 'utf8').split('\n') }; } catch { return undefined; }
    declCache.set(file, e);
  }
  return e.lines[line - 1];
}

/** The footprints a part name may mean: a ref, the variable a board level part was declared as, or a member `A.CF` of an instance or group. */
function partsNamed(boards: BoardRef[], name: string): { fp: SiteFootprint; site: SiteData }[] {
  const out: { fp: SiteFootprint; site: SiteData }[] = [];
  const seen = new Set<string>();
  const add = (site: SiteData, ref: string) => {
    const fp = site.footprints.find((x) => x.ref === ref);
    if (fp && !seen.has(`${site.name}|${ref}`)) { seen.add(`${site.name}|${ref}`); out.push({ fp, site }); }
  };
  for (const b of boards) if (b.site.footprints.some((x) => x.ref === name)) add(b.site, name);
  if (out.length) return out;
  const dot = name.lastIndexOf('.');
  for (const b of boards) {
    const parts = b.site.schematic?.parts ?? [];
    if (dot > 0) {
      const inst = name.slice(0, dot).split('.'), local = name.slice(dot + 1);
      const same = parts.filter((p) => (p.local ?? p.ref) === local && p.path?.length);
      const exact = same.filter((p) => p.path!.join('.') === inst.join('.') || p.path!.at(-1) === inst.at(-1));
      for (const p of exact.length ? exact : same) add(b.site, p.ref);
    } else {
      for (const p of parts) {
        if (p.path?.length || !p.src) continue;
        const text = declLine(isAbsolute(p.src.file) ? p.src.file : resolve(b.root, p.src.file), p.src.line);
        const m = text && /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/.exec(text.slice(0, Math.max(p.src.col - 1, 0)));
        if (m?.[1] === name) add(b.site, p.ref);
      }
    }
  }
  return out;
}

const before = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
const contains = (outer: SourceRange, inner: SourceRange) => !before(inner.start, outer.start) && !before(outer.end, inner.end);

/** A source range, 1-based with an inclusive end, as an LSP range. */
function lspRange(r: SourceRange): Range {
  return { start: { line: r.start[0] - 1, character: r.start[1] - 1 }, end: { line: r.end[0] - 1, character: r.end[1] } };
}

function location(abs: string, s: { line: number; col: number; endLine?: number; endCol?: number }): Location {
  const start = { line: s.line - 1, character: s.col - 1 };
  return { uri: toUri(abs), range: { start, end: s.endLine !== undefined && s.endCol !== undefined ? { line: s.endLine - 1, character: s.endCol } : start } };
}

function dedupeLocations(ls: Location[]): Location[] {
  const seen = new Set<string>();
  return ls.filter((l) => {
    const k = `${l.uri}:${l.range.start.line}:${l.range.start.character}`;
    return !seen.has(k) && !!seen.add(k);
  });
}

function lens(line: number, col: number, title: string): CodeLens {
  const p = { line: line - 1, character: col - 1 };
  return { range: { start: p, end: p }, command: { title, command: '' } };
}

const mm = (v: number) => `${formatNum(v, 3)} mm`;

function routeText(r: NonNullable<SiteData['routes']>[number]): string {
  const parts = [`${r.pair ? 'pair' : 'route'} ${r.net}: **${mm(r.length)}**`];
  if (r.target) {
    const t = r.target;
    const ok = r.length >= t.min - 1e-6 && r.length <= t.max + 1e-6;
    parts.push(`target ${t.max >= 1e6 ? `at least ${mm(t.min)}` : `${formatNum(t.min, 3)} to ${mm(t.max)}`}${ok ? ', met' : r.length < t.min ? ', short' : ', long'}`);
  }
  if (r.group !== undefined) parts.push(`group ${r.group}`);
  if (r.skew !== undefined) parts.push(`skew ${mm(r.skew)}`);
  return parts.join(' · ');
}

/** The instance of a route made by a layout placed several times, unless its net already names it, as `A/sl` does. */
const inst = (r: RouteInfo) => (r.path && !r.net.startsWith(`${r.path}/`) ? `${r.path}: ` : '');

/** Several routes of one call for a hover: one line each, with the instance path of a layout placed several times. */
function routesText(rs: RouteInfo[]): string {
  if (rs.length === 1) return `${inst(rs[0])}${routeText(rs[0])}`;
  const shown = rs.slice(0, 16).map((r) => `- ${inst(r)}${routeText(r)}`);
  return [`${rs.length} routes`, ...shown, ...(rs.length > 16 ? [`- and ${rs.length - 16} more`] : [])].join('\n');
}

/** The lens of a route call or of a helper's call site: the one route, or every route it made with its instance and length. */
function routesTitle(rs: RouteInfo[]): string {
  if (rs.length === 1) return `${inst(rs[0])}${routeText(rs[0]).replace(/\*\*/g, '')}`;
  const one = (r: RouteInfo) => `${inst(r)}${r.net} ${mm(r.length)}${r.target ? (r.length >= r.target.min - 1e-6 && r.length <= r.target.max + 1e-6 ? ' met' : r.length < r.target.min ? ' short' : ' long') : ''}`;
  return `${rs.length} ${rs.every((r) => r.pair) ? 'pairs' : 'routes'}: ${rs.slice(0, 6).map(one).join(' · ')}${rs.length > 6 ? ` · and ${rs.length - 6} more` : ''}`;
}

function findingsTitle(ms: { severity: string; rule: string; kind: string }[]): string {
  const count = (sev: string) => ms.filter((m) => m.severity === sev).length;
  const e = count('error'), w = count('warning');
  const rules = [...new Set(ms.map((m) => m.rule))].join(', ');
  return [e ? `${e} error${e === 1 ? '' : 's'}` : '', w ? `${w} warning${w === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') + `: ${rules}`;
}

/** What a source range drew: item counts by kind, nets, parts, and the command of a path. */
function drew(site: SiteData, r: SourceRange, others?: SiteData[]): string {
  const items = new Map((site.items ?? []).map((it) => [it.id, it]));
  const kinds = new Map<string, number>();
  const nets = new Set<string>();
  for (const id of r.ids) {
    const it = items.get(id);
    if (!it) continue;
    kinds.set(it.kind, (kinds.get(it.kind) ?? 0) + 1);
    if (it.net) nets.add(it.net);
  }
  const list = [...kinds].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`);
  const parts = [`Drew ${list.length ? list.join(', ') : `${r.ids.length} items`} on ${site.title || site.name}${others && others.length > 1 ? ` and ${others.length - 1} more board${others.length > 2 ? 's' : ''}` : ''}`];
  const paths = partPaths(site);
  if (r.refs.length) parts.push(`part${r.refs.length === 1 ? '' : 's'} ${r.refs.slice(0, 8).map((x) => partText(x, paths)).join(', ')}${r.refs.length > 8 ? ', ...' : ''}`);
  if (nets.size) parts.push(`net${nets.size === 1 ? '' : 's'} ${[...nets].slice(0, 6).join(', ')}${nets.size > 6 ? ', ...' : ''}`);
  if (r.seg) parts.push(`command \`${r.seg}\``);
  return parts.join(' · ');
}
