// A name resolves through its declaration, takes its kind from the `$$` brand of its type and reaches board items by recorded source positions.

import { dirname, isAbsolute, resolve } from 'node:path';
import ts from 'typescript';
import type { SiteData } from '@pcbjs/core/site-data';
import { padItems } from './preview.js';
import { isCoordinate, lengthMm, parseAt, parsePoint } from './values.js';

export type TargetKind = 'part' | 'pad' | 'net' | 'group' | 'point' | 'reference';

type Pt = [number, number];

/** What a target is on one board: the items, the parts, the points or the reference to highlight. */
export interface BoardTarget {
  board: string;
  ids: number[];
  refs: string[];
  points?: Pt[];
  reference?: string;
  /** what the target is called on this board: `Q1`, `Q1.2`, `GND`, `CH1`, `25 12.5` */
  name: string;
}

export interface Target {
  kind: TargetKind;
  /** the token or expression, offsets in the text */
  start: number;
  end: number;
  boards: BoardTarget[];
}

export interface TargetBoard { root: string; site: SiteData }

type Val =
  | { kind: 'part'; refs: string[] }
  | { kind: 'pad'; pads: { ref: string; key: string }[] }
  | { kind: 'net'; nets: string[] }
  | { kind: 'group'; paths: string[][] }
  | { kind: 'ports'; paths: string[][] }
  | { kind: 'own'; paths: string[][] }
  | { kind: 'netsOf'; paths: string[][] }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'point'; at: Pt; refs: string[] }
  | { kind: 'reference'; name: string };

interface Cx { checker: ts.TypeChecker; site: SiteData; root: string; depth: number }

const BRANDS: Record<string, TargetKind> = { part: 'part', pin: 'pad', net: 'net', circuit: 'group' };
const KIND_BRAND = { part: 'part', pad: 'pin', net: 'net', group: 'circuit' };
const SAME_PART = new Set(['connect', 'ref', 'source', 'rules']);
const PIN_REF = /^([A-Za-z_][\w]*)\.([\w+\-]+)$/;

/** The target at an offset: the innermost node strictly around it that names something on a board. */
export function targetAt(program: ts.Program, file: string, offset: number, boards: TargetBoard[]): Target | undefined {
  const sf = program.getSourceFile(file);
  if (!sf) return undefined;
  const checker = program.getTypeChecker();
  const mine = boardsOf(file, boards);
  const start = innermost(sf, offset);
  if (start && inSymbolTag(start, mine)) return undefined;
  for (let n = start; n && !ts.isSourceFile(n); n = n.parent) {
    const found: BoardTarget[] = [];
    let kind: TargetKind | undefined;
    for (const b of mine) {
      const v = valueAt(n, { checker, site: b.site, root: b.root, depth: 0 });
      const t = v && onBoard(v, b.site);
      if (!t || !v) continue;
      kind ??= v.kind as TargetKind;
      found.push(t);
    }
    if (kind && found.length) return { kind, start: n.getStart(sf), end: n.getEnd(), boards: found };
  }
  return undefined;
}

/** True inside the tag of a part element that placed a symbol, `<U1 at="4 6" />` in a `<Schematic>`: hover and highlight are the symbol's. */
function inSymbolTag(n: ts.Node, boards: TargetBoard[]): boolean {
  for (let p: ts.Node | undefined = n; p && !ts.isSourceFile(p); p = p.parent) {
    if (!ts.isJsxSelfClosingElement(p) && !ts.isJsxOpeningElement(p)) continue;
    const sf = p.getSourceFile();
    const at = sf.getLineAndCharacterOfPosition((ts.isJsxOpeningElement(p) ? p.parent : p).getStart(sf));
    return boards.some((b) => b.site.schematic.drawing?.symbols.some((s) => s.src && s.src.line === at.line + 1 && s.src.col === at.character + 1 && abs(b.root, s.src.file) === sf.fileName));
  }
  return false;
}

/** The boards built from a file: those whose source index or parts name it, else every board given. */
function boardsOf(file: string, boards: TargetBoard[]): TargetBoard[] {
  const uses = (b: TargetBoard) => Object.keys(b.site.sources ?? {}).some((k) => abs(b.root, k) === file) || b.site.schematic.parts.some((p) => p.src && abs(b.root, p.src.file) === file);
  const own = boards.filter(uses);
  return own.length ? own : boards;
}

/** The innermost node whose span holds the offset strictly inside: a cursor before its first or after its last character is outside. */
function innermost(sf: ts.SourceFile, offset: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (!(n.getStart(sf) < offset && offset < n.getEnd())) return;
    found = n;
    n.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/** What one node names, or undefined; brand-checked against its type. */
function valueAt(n: ts.Node, cx: Cx): Val | undefined {
  if (ts.isStringLiteralLike(n)) return stringValue(n, cx);
  if (ts.isCallExpression(n) && calleeName(n.expression) === 'reference') return referenceValue(n, cx);
  if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n) || ts.isJsxAttributes(n) || ts.isJsxAttribute(n) || ts.isJsxExpression(n)) return undefined;
  if (ts.isIdentifier(n)) return identifierValue(n, cx);
  if (ts.isVariableDeclaration(n)) return n.initializer ? checked(n.name, evalExpr(n.initializer, cx), cx) : undefined;
  if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) return keyValue(n, cx);
  if (ts.isExpression(n)) return checked(n, evalExpr(n, cx), cx);
  return undefined;
}

function identifierValue(id: ts.Identifier, cx: Cx): Val | undefined {
  const p = id.parent;
  if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name === id) return keyValue(p, cx);
  if (ts.isPropertyAccessExpression(p) && p.name === id) return checked(p, evalExpr(p, cx), cx);
  if ((ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isParameter(p)) && p.name === id) return checked(id, symbolValue(cx.checker.getSymbolAtLocation(id), cx), cx);
  if (ts.isBindingElement(p) && p.propertyName === id) return checked(id, symbolValue(cx.checker.getSymbolAtLocation(p.name as ts.Identifier), cx), cx);
  return checked(id, evalExpr(id, cx), cx);
}

/** A key of an object literal: a pin of `X.connect({ VDD: … })`, else what its value names. */
function keyValue(p: ts.PropertyAssignment | ts.ShorthandPropertyAssignment, cx: Cx): Val | undefined {
  const key = propName(p.name);
  const call = p.parent.parent;
  if (key !== undefined && ts.isPropertyAssignment(p) && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'connect') {
    const part = evalExpr(call.expression.expression, cx);
    if (part?.kind === 'part') return { kind: 'pad', pads: part.refs.map((ref) => ({ ref, key })) };
  }
  if (ts.isShorthandPropertyAssignment(p)) return checked(p.name, symbolValue(cx.checker.getShorthandAssignmentValueSymbol(p), cx), cx);
  return checked(p.name, evalExpr(p.initializer, cx), cx);
}

/** The value if the type's brand agrees with it; an untyped or unbranded type takes it as it is. */
function checked(n: ts.Node, v: Val | undefined, cx: Cx): Val | undefined {
  if (!v || !(v.kind in KIND_BRAND)) return v;
  const brand = brandOf(n, cx.checker);
  return brand === undefined || BRANDS[brand] === v.kind ? v : undefined;
}

function brandOf(n: ts.Node, checker: ts.TypeChecker): string | undefined {
  try {
    const type = checker.getTypeAtLocation(n);
    const prop = type.getProperty('$$') ?? checker.getApparentType(type).getProperty('$$');
    if (!prop) return undefined;
    const t = checker.getTypeOfSymbol(prop);
    const lits = t.isUnion() ? t.types : [t];
    for (const l of lits) if (l.isStringLiteral()) return l.value;
  } catch {}
  return undefined;
}

function evalExpr(e: ts.Expression, cx: Cx): Val | undefined {
  if (++cx.depth > 64) return undefined;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) return symbolValue(cx.checker.getSymbolAtLocation(e), cx);
  if (ts.isPropertyAccessExpression(e)) {
    const base = evalExpr(e.expression, cx);
    return base ? member(base, e.name.text, cx) : symbolValue(cx.checker.getSymbolAtLocation(e.name), cx);
  }
  if (ts.isElementAccessExpression(e)) {
    const key = literalText(e.argumentExpression);
    const base = evalExpr(e.expression, cx);
    return base && key !== undefined ? member(base, key, cx) : undefined;
  }
  if (ts.isCallExpression(e)) return callValue(e, cx);
  return undefined;
}

function callValue(e: ts.CallExpression, cx: Cx): Val | undefined {
  const callee = e.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    const m = callee.name.text;
    if (m === 'pad' || m === 'pin') {
      const part = evalExpr(callee.expression, cx), key = e.arguments[0] && literalText(e.arguments[0]);
      if (part?.kind === 'part' && key !== undefined) return { kind: 'pad', pads: part.refs.map((ref) => ({ ref, key })) };
    }
    if (SAME_PART.has(m)) { const v = evalExpr(callee.expression, cx); if (v?.kind === 'part') return v; }
  }
  // `buck.named('Buck1')(ports)`
  if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'named') {
    const name = callee.arguments[0] && literalText(callee.arguments[0]);
    if (name) return groupNamed(name, cx);
  }
  const name = calleeName(callee);
  if (name === 'group' && e.arguments[0]) { const g = literalText(e.arguments[0]); if (g) return groupNamed(g, cx); }
  if (name === 'nets') { const p = e.arguments[0] && literalText(e.arguments[0]); return { kind: 'prefix', prefix: p ? `${p.replace(/\/+$/, '')}/` : '' }; }
  if (name === 'local') { const p = e.arguments[0] && literalText(e.arguments[0]); return { kind: 'prefix', prefix: p ? `${p}/` : '' }; }
  const made = partsMadeAt(e, cx);
  if (made.length) return { kind: 'part', refs: made };
  // a circuit call names its instance with its last string argument, `ledChannel({ VCC, SW }, 'CH1')`
  const last = e.arguments[e.arguments.length - 1];
  const inst = last && e.arguments.length > 1 ? literalText(last) : undefined;
  if (inst) { const g = groupNamed(inst, cx); if (g) return g; }
  return undefined;
}

function symbolValue(sym: ts.Symbol | undefined, cx: Cx): Val | undefined {
  if (!sym || ++cx.depth > 64) return undefined;
  if (sym.flags & ts.SymbolFlags.Alias) { try { sym = cx.checker.getAliasedSymbol(sym); } catch { return undefined; } }
  const d = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!d) return undefined;
  if (ts.isVariableDeclaration(d)) {
    const v = d.initializer ? evalExpr(d.initializer, cx) : undefined;
    return v ?? (ts.isIdentifier(d.name) ? namedFallback(d.name.text, cx) : undefined);
  }
  if (ts.isBindingElement(d)) return bindingValue(d, cx);
  if (ts.isParameter(d)) return paramValue(d, cx);
  if (ts.isPropertyAssignment(d)) return evalExpr(d.initializer, cx);
  if (ts.isShorthandPropertyAssignment(d)) return symbolValue(cx.checker.getShorthandAssignmentValueSymbol(d), cx);
  return undefined;
}

/** `const { GND } = nets()`, `({ VCC }: Ports<…>, { nets: { led } })`: the source of the pattern, then the key. */
function bindingValue(d: ts.BindingElement, cx: Cx): Val | undefined {
  const key = d.propertyName ? propName(d.propertyName) : ts.isIdentifier(d.name) ? d.name.text : undefined;
  if (key === undefined) return undefined;
  const src = patternValue(d.parent, cx);
  if (src) return member(src, key, cx);
  // `const { U1 } = sch` of a module namespace: the export it names
  const holder = d.parent.parent;
  const init = ts.isVariableDeclaration(holder) ? holder.initializer : undefined;
  const prop = init && cx.checker.getTypeAtLocation(init).getProperty(key);
  return prop ? symbolValue(prop, cx) : undefined;
}

function patternValue(pattern: ts.BindingPattern, cx: Cx): Val | undefined {
  const holder = pattern.parent;
  if (ts.isBindingElement(holder)) return bindingValue(holder, cx);
  if (ts.isVariableDeclaration(holder)) return holder.initializer ? evalExpr(holder.initializer, cx) : undefined;
  if (ts.isParameter(holder)) return paramValue(holder, cx);
  return undefined;
}

/** A parameter of a circuit build, `(ports, own)`, or of a layout's render, `(g, props)`: the instances it stands for. */
function paramValue(p: ts.ParameterDeclaration, cx: Cx): Val | undefined {
  const fn = p.parent;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
  let call: ts.Node = fn.parent;
  while (ts.isParenthesizedExpression(call)) call = call.parent;
  if (!ts.isCallExpression(call)) return undefined;
  const idx = fn.parameters.indexOf(p), name = calleeName(call.expression);
  if (name === 'circuit') {
    const circ = call.arguments[0] && literalText(call.arguments[0]);
    const paths = cx.site.schematic.circuits.filter((c) => c.circuit === circ).map((c) => c.path);
    return idx === 0 ? { kind: 'ports', paths } : idx === 1 ? { kind: 'own', paths } : undefined;
  }
  if (name === 'layout' && idx === 0) {
    const label = call.arguments[2] && literalText(call.arguments[2]);
    const byLayout = label ? cx.site.schematic.circuits.filter((c) => c.layout === label) : [];
    if (byLayout.length) return { kind: 'group', paths: byLayout.map((c) => c.path) };
    const target = call.arguments[0] && evalExpr(call.arguments[0], cx);
    if (target?.kind === 'group') return target;
    const circ = call.arguments[0] && circuitName(call.arguments[0], cx);
    const paths = cx.site.schematic.circuits.filter((c) => c.circuit === circ).map((c) => c.path);
    return paths.length ? { kind: 'group', paths } : undefined;
  }
  return undefined;
}

/** The name of a circuit definition, `circuit('ledChannel', …)`, through the variable it is bound to. */
function circuitName(e: ts.Expression, cx: Cx): string | undefined {
  let sym = ts.isIdentifier(e) ? cx.checker.getSymbolAtLocation(e) : undefined;
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = cx.checker.getAliasedSymbol(sym);
  const d = sym?.valueDeclaration;
  const init = d && ts.isVariableDeclaration(d) ? d.initializer : undefined;
  return init && ts.isCallExpression(init) && calleeName(init.expression) === 'circuit' && init.arguments[0] ? literalText(init.arguments[0]) : undefined;
}

/** A member of a value: a pin of a part, a part or instance of an instance, a port or a private net. */
function member(base: Val, key: string, cx: Cx): Val | undefined {
  const sch = cx.site.schematic;
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  switch (base.kind) {
    case 'part': return { kind: 'pad', pads: base.refs.map((ref) => ({ ref, key })) };
    case 'group': {
      if (key === 'ports') return { kind: 'ports', paths: base.paths };
      if (key === 'nets') return { kind: 'netsOf', paths: base.paths };
      const refs = sch.parts.filter((p) => p.local === key && base.paths.some((q) => same(p.path, q))).map((p) => p.ref);
      if (refs.length) return { kind: 'part', refs };
      const kids = base.paths.map((q) => [...q, key]).filter((q) => sch.circuits.some((c) => same(c.path, q)));
      return kids.length ? { kind: 'group', paths: kids } : undefined;
    }
    case 'own': return key === 'nets' || key === 'local' ? { kind: 'netsOf', paths: base.paths } : undefined;
    case 'netsOf': return { kind: 'net', nets: base.paths.map((q) => `${q.join('/')}/${key}`) };
    case 'ports': return { kind: 'net', nets: [key] };
    case 'prefix': return { kind: 'net', nets: [`${base.prefix}${key}`] };
    default: return undefined;
  }
}

function groupNamed(name: string, cx: Cx): Val | undefined {
  const paths = cx.site.schematic.circuits.filter((c) => c.name === name).map((c) => c.path);
  return paths.length ? { kind: 'group', paths } : undefined;
}

/** A name the declarations did not resolve: a part by its ref, a net or an instance by its name. */
function namedFallback(name: string, cx: Cx): Val | undefined {
  if (cx.site.footprints.some((f) => f.ref === name)) return { kind: 'part', refs: [name] };
  if (cx.site.nets.includes(name)) return { kind: 'net', nets: [name] };
  return groupNamed(name, cx);
}

/** The parts whose factory call starts where this call does. */
function partsMadeAt(e: ts.CallExpression, cx: Cx): string[] {
  const sf = e.getSourceFile();
  const p = sf.getLineAndCharacterOfPosition(e.getStart(sf));
  return cx.site.schematic.parts.filter((x) => x.src && x.src.line === p.line + 1 && x.src.col === p.character + 1 && abs(cx.root, x.src.file) === sf.fileName).map((x) => x.ref);
}

function stringValue(s: ts.StringLiteralLike, cx: Cx): Val | undefined {
  const text = s.text, p = s.parent;
  const prop = ts.isJsxAttribute(p) ? propName(p.name as ts.Identifier) : ts.isPropertyAssignment(p) ? propName(p.name) : undefined;
  if (prop === 'at' && parseAt(text)) return pointValue(s, text, cx);
  const inCall = ts.isCallExpression(p) && p.arguments.includes(s as ts.Expression);
  if (inCall && isCoordinate(text)) return pointValue(s, text, cx);
  const m = inCall ? PIN_REF.exec(text) : null;
  if (m && cx.site.footprints.some((f) => f.ref === m[1])) return { kind: 'pad', pads: [{ ref: m[1], key: m[2] }] };
  return undefined;
}

/** An `at` of a placed part is where its parts went; any other point is read as board mm. */
function pointValue(s: ts.StringLiteralLike, text: string, cx: Cx): Val | undefined {
  const attr = s.parent;
  const el = ts.isJsxAttribute(attr) ? attr.parent.parent : undefined;
  const tag = el && (ts.isJsxSelfClosingElement(el) || ts.isJsxOpeningElement(el)) ? el.tagName : undefined;
  const placed = tag ? evalExpr(tag as ts.Expression, cx) : undefined;
  if (placed?.kind === 'part') {
    const fps = cx.site.footprints.filter((f) => placed.refs.includes(f.ref));
    if (fps.length) return { kind: 'point', at: fps[0].at, refs: fps.map((f) => f.ref) };
  }
  const pt = parsePoint(text);
  const x = pt && lengthMm(pt.x), y = pt && lengthMm(pt.y);
  return x === undefined || y === undefined ? undefined : { kind: 'point', at: [x, y], refs: [] };
}

function referenceValue(call: ts.CallExpression, cx: Cx): Val | undefined {
  const path = call.arguments[0] && literalText(call.arguments[0]);
  if (!path) return undefined;
  const entry = resolve(dirname(call.getSourceFile().fileName), path);
  const r = (cx.site.references ?? []).find((x) => abs(cx.root, x.entry) === entry);
  return r ? { kind: 'reference', name: r.name } : undefined;
}

function onBoard(v: Val, site: SiteData): BoardTarget | undefined {
  const base = { board: site.name, ids: [] as number[], refs: [] as string[] };
  switch (v.kind) {
    case 'part': {
      const refs = v.refs.filter((r) => site.footprints.some((f) => f.ref === r));
      return refs.length ? { ...base, refs, name: refs.join(', ') } : undefined;
    }
    case 'pad': {
      const ids: number[] = [], names: string[] = [];
      for (const { ref, key } of v.pads) {
        const pads = padItems(site, ref);
        const hit = pads.filter((p) => p.num === key);
        for (const p of hit.length ? hit : pads.filter((q) => q.name === key)) { ids.push(p.item.id); names.push(`${ref}.${p.num}`); }
      }
      return ids.length ? { ...base, ids, name: names.join(', ') } : undefined;
    }
    case 'net': {
      const nets = new Set(v.nets.filter((n) => site.nets.includes(n)));
      const ids = (site.items ?? []).filter((i) => i.net !== undefined && nets.has(i.net)).map((i) => i.id);
      return nets.size ? { ...base, ids, name: [...nets].join(', ') } : undefined;
    }
    case 'group': {
      const under = (p: string[], q: string[]) => q.length <= p.length && q.every((x, i) => p[i] === x);
      const refs = site.schematic.parts.filter((p) => v.paths.some((q) => under(p.path, q))).map((p) => p.ref).filter((r) => site.footprints.some((f) => f.ref === r));
      return refs.length ? { ...base, refs, name: v.paths.map((q) => q.join('/')).join(', ') } : undefined;
    }
    case 'point': {
      const fps = site.footprints.filter((f) => v.refs.includes(f.ref));
      const points: Pt[] = fps.length ? fps.map((f) => f.at) : [v.at];
      return { ...base, points, name: points.map(([x, y]) => `${round(x)} ${round(y)}`).join(', ') };
    }
    case 'reference': return { ...base, reference: v.name, name: v.name };
    default: return undefined;
  }
}

const round = (v: number) => String(Math.round(v * 1000) / 1000);
const abs = (root: string, f: string) => (isAbsolute(f) ? f : resolve(root, f));

function calleeName(e: ts.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function propName(n: ts.PropertyName | ts.JsxAttributeName): string | undefined {
  return ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) ? n.text : undefined;
}

function literalText(e: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return e.text;
  return undefined;
}

/** Where the code connects a pad: its key in a `.connect({ … })` of its part, or its argument in a positional `.connect(…)`. */
export function padSource(service: (file: string) => ts.LanguageService | undefined, board: TargetBoard, ref: string, num: string): { file: string; start: number; end: number } | undefined {
  const sp = board.site.schematic.parts.find((p) => p.ref === ref);
  const pad = board.site.footprints.find((f) => f.ref === ref)?.pads.find((p) => p.num === num);
  if (!sp?.src || !pad) return undefined;
  const file = abs(board.root, sp.src.file);
  const ls = service(file), sf = ls?.getProgram()?.getSourceFile(file);
  if (!ls || !sf) return undefined;
  let made: ts.Node | undefined;
  const at = sf.getPositionOfLineAndCharacter(sp.src.line - 1, sp.src.col - 1);
  const visit = (n: ts.Node): void => { if (n.getStart(sf) <= at && at < n.getEnd()) { if (ts.isCallExpression(n) && n.getStart(sf) === at) made = n; n.forEachChild(visit); } };
  sf.forEachChild(visit);
  if (!made) return undefined;
  const calls: ts.CallExpression[] = [];
  let top: ts.Node = made;
  for (;;) {
    const p = top.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === top && ts.isCallExpression(p.parent)) {
      if (p.name.text === 'connect') calls.push(p.parent);
      top = p.parent;
    } else break;
  }
  const decl = top.parent;
  const name = decl && (ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl)) && ts.isIdentifier(decl.name) ? decl.name : undefined;
  if (name) for (const r of ls.getReferencesAtPosition(file, name.getStart(sf)) ?? []) {
    const rf = ls.getProgram()?.getSourceFile(r.fileName);
    const node = rf && innermostAt(rf, r.textSpan.start);
    const access = node?.parent;
    if (access && ts.isPropertyAccessExpression(access) && access.expression === node && access.name.text === 'connect' && ts.isCallExpression(access.parent)) calls.push(access.parent);
  }
  const pins = sp.pins.map((p) => p.name);
  for (const c of calls) {
    const arg = c.arguments[0];
    const csf = c.getSourceFile();
    const span = (n: ts.Node) => ({ file: csf.fileName, start: n.getStart(csf), end: n.getEnd() });
    if (arg && ts.isObjectLiteralExpression(arg)) {
      const prop = arg.properties.find((p) => p.name && [pad.name, pad.num].includes(propName(p.name) ?? ''));
      if (prop?.name) return span(prop.name);
    } else {
      const i = pins.indexOf(pad.name);
      if (i >= 0 && c.arguments[i]) return span(c.arguments[i]);
    }
  }
  return undefined;
}

function innermostAt(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => { if (n.getStart(sf) <= pos && pos < n.getEnd()) { found = n; n.forEachChild(visit); } };
  sf.forEachChild(visit);
  return found;
}
