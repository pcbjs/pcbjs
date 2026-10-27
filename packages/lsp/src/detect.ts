// Offsets are UTF-16 code units; `start` to `end` is a literal's inner text, inside the quotes or the number with its minus sign.

import ts from 'typescript';
import { isCoordinate, parseToken, lengthMm, parseAt } from './values.js';

/** What a literal holds; `rotation` nests inside an `at`, `copper` is a layer count, `length` any other length prop. */
export type Kind = 'at' | 'point' | 'layer' | 'size' | 'width' | 'thickness' | 'drill' | 'side' | 'routePath' | 'svgPath' | 'rotation' | 'pinRef' | 'copper' | 'number' | 'length' | 'chainCommand';

/** The commands of a route chain, `route(a).V(14).via('B.Cu').X(b)`; a `chainCommand` hit spans one call from its name to its parenthesis. */
export const CHAIN_COMMANDS: ReadonlySet<string> = new Set(['L', 'l', 'H', 'h', 'V', 'v', 'via', 'Z', 'X']);

export const NUMERIC_KINDS: ReadonlySet<Kind> = new Set(['size', 'width', 'thickness', 'drill', 'length']);

export interface HitContext {
  /** The prop, property or argument the literal belongs to: `at`, `layer`, `width`, `d`, `path`, `a`, `b`... */
  prop: string;
  /** The JSX element or helper call that owns it: `text`, `J1`, `track`, `route`, `via`, `pour`. */
  owner: string;
  /** How the literal is written: a quote character, or `number` for a numeric literal. */
  quote: '"' | "'" | '`' | 'number';
  /** The position in an array literal, as in `layers={['F.Cu', 'B.Cu']}` or `size={[0.9, 0.8]}`. */
  index?: number;
  /** true for a builder method such as `.width(0.25)` or `.layer('B.Cu')`. */
  chain?: boolean;
  /** For a pinRef: the part as written, `U1` in `'U1.3'`, `J1[3]` or `U1.pad('6')`, and the form the pad is written in. */
  ref?: string;
  form?: 'dotted' | 'index' | 'pad';
  /** For a chainCommand: the offset of the dot before the method name, and the argument texts as written. */
  dot?: number;
  args?: string[];
}

export interface Hit {
  kind: Kind;
  start: number;
  end: number;
  /** The inner text of the literal as written. */
  value: string;
  context: HitContext;
}

const JSX_PROPS: Record<string, Kind> = {
  at: 'at', layer: 'layer', layers: 'layer', size: 'size', width: 'width', thickness: 'thickness', drill: 'drill', side: 'side', copper: 'copper',
  x: 'length', y: 'length', w: 'length', h: 'length', r: 'length', cx: 'length', cy: 'length', rx: 'length', ry: 'length', height: 'length',
};
const D_ELEMENTS = new Set(['track', 'path', 'zone']);
const OBJ_PROPS: Record<string, Kind> = { at: 'at', layer: 'layer', layers: 'layer', width: 'width', drill: 'drill', size: 'size', d: 'svgPath' };
const CHAIN_METHODS: Record<string, Kind> = { width: 'width', layer: 'layer', layers: 'layer', impedance: 'number', priority: 'number' };
const PIN_DOTTED = /^([A-Za-z_][\w]*)\.([\w+\-]+)$/;

/** What else the detector may know: the names of the functions that make routes, whose arguments are route ends too. */
export interface DetectOptions { routeHelpers?: ReadonlySet<string> }

/** Every editable literal in document order; the pad arguments of a call of one of `routeHelpers` are route ends too. */
export function detect(text: string, fileName = 'design.tsx', opts: DetectOptions = {}): Hit[] {
  const kind = /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX : /\.jsx$/i.test(fileName) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const hits: Hit[] = [];

  const add = (k: Kind, expr: ts.Expression | undefined, prop: string, owner: string, extra: Partial<HitContext> = {}): void => {
    if (!expr) return;
    const lit = literal(expr, sf, text);
    if (!lit) return;
    if (NUMERIC_KINDS.has(k)) {
      const t = parseToken(lit.value);
      if (!t || lengthMm(t) === undefined) return;
    } else if (k === 'copper' || k === 'number') {
      if (lit.quote !== 'number') return;
    } else if (lit.quote === 'number') return;
    if (k === 'point' && !isCoordinate(lit.value)) return;
    if (k === 'at' && !/\S/.test(lit.value)) return;
    hits.push({ kind: k, start: lit.start, end: lit.end, value: lit.value, context: { prop, owner, quote: lit.quote, ...extra } });
    // the rotation of a position is a value of its own, nested inside it
    if (k === 'at') {
      const a = parseAt(lit.value);
      const m = a?.rot && /^(\s*\S+[\s,]+\S+[\s,]+)(\S+)\s*$/.exec(lit.value);
      if (m) hits.push({ kind: 'rotation', start: lit.start + m[1].length, end: lit.start + m[1].length + m[2].length, value: m[2], context: { prop, owner, quote: lit.quote, ...extra } });
    }
  };

  /** A route end naming a pad, `'U1.3'`, `J1[3]`, `U1.pad('6')` or `A.CF[2]`, or a pair of them in an array. */
  const addPin = (expr: ts.Expression | undefined, prop: string, owner = 'route'): void => {
    if (!expr) return;
    const e = unwrap(expr);
    if (ts.isArrayLiteralExpression(e)) {
      e.elements.forEach((el) => addPin(el, prop, owner));
      return;
    }
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      const lit = literal(e, sf, text);
      const m = lit && PIN_DOTTED.exec(lit.value);
      if (lit && m && !isCoordinate(lit.value)) hits.push({ kind: 'pinRef', start: lit.start, end: lit.end, value: lit.value, context: { prop, owner, quote: lit.quote, ref: m[1], form: 'dotted' } });
      return;
    }
    if (ts.isElementAccessExpression(e)) {
      const ref = partName(e.expression);
      const lit = ref && literal(e.argumentExpression, sf, text);
      if (lit) hits.push({ kind: 'pinRef', start: lit.start, end: lit.end, value: lit.value, context: { prop, owner, quote: lit.quote, ref, form: 'index' } });
      return;
    }
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'pad' && e.arguments[0]) {
      const ref = partName(e.expression.expression);
      const lit = ref && literal(e.arguments[0], sf, text);
      if (lit) hits.push({ kind: 'pinRef', start: lit.start, end: lit.end, value: lit.value, context: { prop, owner, quote: lit.quote, ref, form: 'pad' } });
    }
  };

  /** A literal, or each element of an array literal, for props such as `layers` and `size` that take arrays. */
  const addMaybeArray = (k: Kind, expr: ts.Expression | undefined, prop: string, owner: string, extra: Partial<HitContext> = {}): void => {
    if (!expr) return;
    const e = unwrap(expr);
    if (ts.isArrayLiteralExpression(e)) {
      if (k === 'at' || k === 'side' || k === 'copper') return;
      e.elements.forEach((el, index) => add(k, el, prop, owner, { ...extra, index }));
    } else add(k, e, prop, owner, extra);
  };

  const addObject = (obj: ts.Expression | undefined, owner: string, allowed: Record<string, Kind>): void => {
    if (!obj) return;
    const o = unwrap(obj);
    if (!ts.isObjectLiteralExpression(o)) return;
    for (const p of o.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const name = propName(p.name);
      if (name && allowed[name]) addMaybeArray(allowed[name], p.initializer, name, owner);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) jsxAttribute(node);
    else if (ts.isCallExpression(node)) call(node);
    ts.forEachChild(node, visit);
  };

  function jsxAttribute(node: ts.JsxAttribute): void {
    const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
    if (!name) return;
    const el = node.parent?.parent;
    const owner = el && (ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el)) ? el.tagName.getText(sf) : '';
    const init = node.initializer;
    if (!init) return;
    const expr = ts.isJsxExpression(init) ? init.expression : init;
    if (!expr) return;
    if (name === 'd') {
      if (D_ELEMENTS.has(owner)) add('svgPath', expr as ts.Expression, 'd', owner);
      return;
    }
    const k = JSX_PROPS[name];
    if (k) addMaybeArray(k, expr as ts.Expression, name, owner);
  }

  function call(node: ts.CallExpression): void {
    const callee = calleeName(node.expression);
    const args = node.arguments;
    if (callee && opts.routeHelpers?.has(callee) && !onRoute(node)) {
      args.forEach((a, i) => addPin(a, `arg${i + 1}`, callee));
      return;
    }
    if (callee === 'route') {
      const first = args[0] && unwrap(args[0]);
      if (first && ts.isObjectLiteralExpression(first)) return addObject(first, 'track', OBJ_PROPS);
      const second = args[1] && unwrap(args[1]);
      if (second && ts.isObjectLiteralExpression(second)) return addObject(second, 'route', OBJ_PROPS);
      add('point', args[0], 'a', 'route');
      add('point', args[1], 'b', 'route');
      addPin(args[0], 'a');
      addPin(args[1], 'b');
      if (args.length >= 3) add('routePath', args[2], 'path', 'route');
      return;
    }
    if (callee === 'via') {
      const first = args[0] && unwrap(args[0]);
      if (first && ts.isObjectLiteralExpression(first)) return addObject(first, 'via', OBJ_PROPS);
      add('at', args[1], 'at', 'via');
      addObject(args[2], 'via', OBJ_PROPS);
      return;
    }
    if (callee === 'pour') {
      const first = args[0] && unwrap(args[0]);
      if (first && ts.isObjectLiteralExpression(first)) return addObject(first, 'zone', OBJ_PROPS);
      add('layer', args[1], 'layer', 'zone');
      add('svgPath', args[2], 'd', 'zone');
      return;
    }
    if (ts.isPropertyAccessExpression(node.expression) && onRoute(node.expression.expression)) {
      const method = node.expression.name.text;
      if (CHAIN_COMMANDS.has(method)) {
        const name = node.expression.name;
        const start = name.getStart(sf);
        let dot = start - 1;
        while (dot > 0 && /\s/.test(text[dot])) dot--;
        // an unclosed call is partial code: no hit
        if (text[node.end - 1] === ')') {
          hits.push({ kind: 'chainCommand', start, end: node.end, value: text.slice(start, node.end), context: { prop: method, owner: 'route', quote: 'number', chain: true, dot: text[dot] === '.' ? dot : start, args: args.map((a) => a.getText(sf)) } });
        }
        if (method === 'Z' || method === 'X') {
          add('point', args[0], 'target', 'route');
          addPin(args[0], 'target');
        }
      } else if (CHAIN_METHODS[method]) addMaybeArray(CHAIN_METHODS[method], args[0], method, 'route', { chain: true });
      else if (method === 'vias') addObject(args[0], 'via', { drill: 'drill', size: 'size' });
    }
  }

  visit(sf);
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

/** The innermost hit whose literal contains the offset, the ends included so a cursor just inside a quote counts. */
export function hitAt(hits: Hit[], offset: number): Hit | undefined {
  let best: Hit | undefined;
  for (const h of hits) if (h.start <= offset && offset <= h.end && (!best || h.end - h.start < best.end - best.start)) best = h;
  return best;
}

/** The text to put between the quotes for a new value, or an error when the literal cannot hold it. */
export function encodeValue(hit: Hit, value: string): { text: string } | { error: string } {
  const q = hit.context.quote;
  if (q === 'number') {
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value)) return { error: `${JSON.stringify(value)} is not a plain number` };
    return { text: value };
  }
  if (/[\\\r\n]/.test(value) || value.includes(q) || (q === '`' && value.includes('${'))) return { error: `${JSON.stringify(value)} cannot be written inside ${q}${q}` };
  return { text: value };
}

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}

/** The part an expression names, as written: `J1`, or a member of an instance or a group such as `A.CF` or `g.RS`. */
function partName(e: ts.Expression): string | undefined {
  e = unwrap(e);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
    const head = partName(e.expression);
    return head ? `${head}.${e.name.text}` : undefined;
  }
  return undefined;
}

/** Every call expression of a file as offsets, from its callee to its closing parenthesis: where a helper's call site may sit. */
export function callSpans(text: string, fileName = 'design.tsx'): { start: number; end: number }[] {
  const kind = /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX : /\.jsx$/i.test(fileName) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const out: { start: number; end: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) out.push({ start: node.getStart(sf), end: node.end });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function propName(n: ts.PropertyName): string | undefined {
  return ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : undefined;
}

function calleeName(e: ts.Expression): string | undefined {
  e = unwrap(e);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && !ts.isCallExpression(unwrap(e.expression))) return e.name.text;
  return undefined;
}

/** True when the expression is a route(...) call, possibly followed by more builder calls. */
function onRoute(e: ts.Expression): boolean {
  e = unwrap(e);
  for (let depth = 0; depth < 32; depth++) {
    if (!ts.isCallExpression(e)) return false;
    if (calleeName(e.expression) === 'route') return true;
    const callee = unwrap(e.expression);
    if (!ts.isPropertyAccessExpression(callee)) return false;
    e = unwrap(callee.expression);
  }
  return false;
}

interface Literal {
  start: number;
  end: number;
  value: string;
  quote: HitContext['quote'];
}

function literal(expr: ts.Expression, sf: ts.SourceFile, text: string): Literal | undefined {
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    const s = e.getStart(sf);
    const q = text[s] as '"' | "'" | '`';
    // Unterminated: the parser ends the literal at the line end without a closing quote.
    if (e.end - s < 2 || text[e.end - 1] !== q) return undefined;
    const value = text.slice(s + 1, e.end - 1);
    // A backslash needs unescaping, and a line break in a JSX attribute string is usually a quote not yet closed.
    if (/[\\\r\n]/.test(value)) return undefined;
    return { start: s + 1, end: e.end - 1, value, quote: q };
  }
  if (ts.isNumericLiteral(e)) {
    const s = e.getStart(sf);
    return { start: s, end: e.end, value: text.slice(s, e.end), quote: 'number' };
  }
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) {
    const s = e.getStart(sf);
    const value = text.slice(s, e.end);
    if (!/^-\d|^-\.\d/.test(value)) return undefined;
    return { start: s, end: e.end, value, quote: 'number' };
  }
  return undefined;
}

/** One `route(...)` call with the builder chain after it: offsets of the call and of the whole chain. */
export interface RouteCall {
  /** the `route` identifier to the closing parenthesis of the call itself */
  start: number;
  end: number;
  /** the end of the chain of builder calls on it, `end` when there is none */
  chainEnd: number;
  /** true when the code gives a width: a `width` property or a `.width()` call */
  hasWidth: boolean;
}

/** Every route call of a file, in document order, for the lenses and the inlay hints of resolved widths. */
export function routeCalls(text: string, fileName = 'design.tsx'): RouteCall[] {
  const kind = /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX : /\.jsx$/i.test(fileName) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const out: RouteCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === 'route' && !ts.isPropertyAccessExpression(unwrap(node.expression))) {
      let top: ts.Node = node;
      let hasWidth = node.arguments.some((a) => {
        const o = unwrap(a);
        return ts.isObjectLiteralExpression(o) && o.properties.some((p) => ts.isPropertyAssignment(p) && propName(p.name) === 'width');
      });
      while (top.parent && ts.isPropertyAccessExpression(top.parent) && top.parent.parent && ts.isCallExpression(top.parent.parent) && top.parent.parent.expression === top.parent) {
        if (top.parent.name.text === 'width') hasWidth = true;
        top = top.parent.parent;
      }
      out.push({ start: node.getStart(sf), end: node.end, chainEnd: top.end, hasWidth });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
