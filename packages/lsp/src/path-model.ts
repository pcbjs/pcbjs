// `route` is the path of route(a, b, path), starting at a hidden M at `a`; `svg` is plain SVG path data.

import { NUM_RE, formatNum } from './values.js';

export type Grammar = 'route' | 'svg';

export interface Row {
  /** The command as written: L, l, H, h, V, v, X, x, @, Z, XZ, and for svg also M, m, C, S, Q, T, A in both cases. */
  cmd: string;
  /** Number arguments as written, or the layer name of an @ row. */
  args: string[];
  /** Offset of the command's letter, or of its first number for an implicit repeat; `end` is after its last argument. */
  start?: number;
  end?: number;
}

export interface Parsed {
  rows: Row[];
  /** Problems found while reading the string; the rows hold what could be read. */
  errors: string[];
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, X: 2, Z: 0, XZ: 0, '@': 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
const CURVES = new Set(['A', 'C', 'Q', 'S', 'T']);

export function arity(cmd: string): number {
  return ARITY[cmd === '@' || cmd === 'XZ' ? cmd : cmd.toUpperCase()] ?? 0;
}

/** The commands a row may switch to in this grammar, in menu order. */
export function commands(grammar: Grammar): string[] {
  return grammar === 'route' ? ['L', 'l', 'H', 'h', 'V', 'v', 'X', 'x', '@'] : ['M', 'm', 'L', 'l', 'H', 'h', 'V', 'v', 'C', 'c', 'S', 's', 'Q', 'q', 'T', 't', 'A', 'a', 'Z'];
}

/** Read a path leniently: every command becomes one row, implicit repeats become rows of their own. */
export function parsePath(src: string, grammar: Grammar): Parsed {
  const rows: Row[] = [];
  const errors: string[] = [];
  let i = 0;
  const skip = () => {
    while (i < src.length && /[\s,]/.test(src[i])) i++;
  };
  let cur: string | undefined;
  while (true) {
    skip();
    if (i >= src.length) break;
    const c = src[i];
    const at = i;
    if (c === '@' || ((c === 'U' || c === 'u') && grammar === 'route')) {
      i++;
      if (c === '@') while (i < src.length && /\s/.test(src[i])) i++;
      else skip();
      const m = /^[A-Za-z0-9._]+/.exec(src.slice(i));
      if (!m || /^(?:[A-Za-z]|XZ)$/i.test(m[0])) {
        errors.push(`${c} needs a layer, for example @B.Cu, at character ${i + 1}`);
        rows.push({ cmd: '@', args: [''], start: at, end: i });
      } else {
        i += m[0].length;
        rows.push({ cmd: '@', args: [m[0]], start: at, end: i });
      }
      cur = undefined;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      i++;
      if ((c === 'X' || c === 'x') && grammar === 'route') {
        skip();
        if (/[Zz]/.test(src[i] ?? '')) {
          i++;
          rows.push({ cmd: 'XZ', args: [], start: at, end: i });
          cur = undefined;
          continue;
        }
      }
      if (!(c.toUpperCase() in ARITY) || (c.toUpperCase() === 'X' && grammar === 'svg')) {
        errors.push(`unknown command ${c} at character ${i}`);
        cur = undefined;
        continue;
      }
      cur = c;
      if (arity(c) === 0) {
        rows.push({ cmd: c, args: [], start: at, end: i });
        cur = undefined;
        continue;
      }
      readArgs(c, at);
      continue;
    }
    if (NUM_RE.test(src.slice(i)) && cur) {
      // An implicit repeat; after M it is L, as in SVG.
      readArgs(cur === 'M' ? 'L' : cur === 'm' ? 'l' : cur, at);
      continue;
    }
    errors.push(`unexpected ${JSON.stringify(c)} at character ${i + 1}`);
    i++;
  }
  return { rows, errors };

  function readArgs(cmd: string, at: number): void {
    const args: string[] = [];
    for (let k = 0; k < arity(cmd); k++) {
      skip();
      const m = NUM_RE.exec(src.slice(i));
      if (!m) {
        errors.push(`${cmd} expects ${arity(cmd)} numbers, found ${k}, at character ${i + 1}`);
        break;
      }
      i += m[0].length;
      args.push(m[0]);
    }
    while (args.length < arity(cmd)) args.push('');
    rows.push({ cmd, args, start: at, end: i });
    cur = cmd;
  }
}

/** Every reason the rows would not compile, empty when they are fine. */
export function validate(rows: Row[], grammar: Grammar): string[] {
  const errs: string[] = [];
  rows.forEach((r, i) => {
    const n = `row ${i + 1}`;
    const up = r.cmd === 'XZ' || r.cmd === '@' ? r.cmd : r.cmd.toUpperCase();
    if (!(up in ARITY)) return errs.push(`${n}: unknown command ${r.cmd}`);
    if (grammar === 'route') {
      if (up === 'M') errs.push(`${n}: the path starts at a, leave out ${r.cmd}`);
      else if (CURVES.has(up)) errs.push(`${n}: ${r.cmd} is a curve, a route path takes only L, H, V, X, @, Z and XZ`);
      if ((up === 'Z' || up === 'XZ') && i !== rows.length - 1) errs.push(`${n}: ${r.cmd} ends the route at b, nothing may follow it`);
    } else {
      if (up === 'X' || up === 'XZ' || up === '@') errs.push(`${n}: ${r.cmd} belongs to route paths, not to SVG path data`);
      if (i === 0 && up !== 'M') errs.push(`${n}: SVG path data starts with M`);
    }
    if (up === '@') {
      const l = r.args[0] ?? '';
      if (!/^[A-Za-z0-9._]+$/.test(l) || /^(?:[A-Za-z]|XZ)$/i.test(l)) errs.push(`${n}: @ needs a layer, for example @B.Cu`);
    } else {
      if (r.args.length !== arity(r.cmd)) errs.push(`${n}: ${r.cmd} takes ${arity(r.cmd)} numbers`);
      r.args.forEach((a, k) => {
        const m = NUM_RE.exec(a.trim());
        if (!m || m[0].length !== a.trim().length) errs.push(`${n}: argument ${k + 1} of ${r.cmd} is not a number: ${JSON.stringify(a)}`);
      });
    }
  });
  if (grammar === 'route' && rows.length) {
    const last = rows[rows.length - 1].cmd.toUpperCase();
    if (last !== 'Z' && last !== 'XZ') errs.push('the route must end at b, with Z for a straight track or XZ for an automatic leg');
  }
  return errs;
}

export function serialise(rows: Row[]): string {
  return rows.map((r) => (r.cmd === '@' ? `@${r.args[0] ?? ''}` : [r.cmd, ...r.args.map((a) => a.trim())].join(' '))).join(' ');
}

/** The absolute cursor after row i, when it is known: route paths start at an unknown `a`. */
export function cursorAfter(rows: Row[], i: number, grammar: Grammar): { x: number; y: number } | undefined {
  let p: { x: number; y: number } | undefined = grammar === 'route' ? undefined : { x: 0, y: 0 };
  let start = p;
  for (let k = 0; k <= i && k < rows.length; k++) {
    const r = rows[k];
    const a = r.args.map(Number);
    const rel = r.cmd !== r.cmd.toUpperCase() && r.cmd !== '@';
    const up = r.cmd === '@' || r.cmd === 'XZ' ? r.cmd : r.cmd.toUpperCase();
    if (up === 'H') p = rel ? p && { x: p.x + a[0], y: p.y } : p && { x: a[0], y: p.y };
    else if (up === 'V') p = rel ? p && { x: p.x, y: p.y + a[0] } : p && { x: p.x, y: a[0] };
    else if (up === 'Z' || up === 'XZ') p = start;
    else if (up !== '@' && a.length >= 2) {
      const x = a[a.length - 2];
      const y = a[a.length - 1];
      p = rel ? p && { x: p.x + x, y: p.y + y } : { x, y };
      if (up === 'M') start = p;
    }
    if (p && (!Number.isFinite(p.x) || !Number.isFinite(p.y))) p = undefined;
  }
  return p;
}

// edits: each returns new rows and leaves its input alone

export function setArg(rows: Row[], i: number, j: number, value: string): Row[] {
  return rows.map((r, k) => (k === i ? { cmd: r.cmd, args: r.args.map((a, m) => (m === j ? value.trim() : a)) } : r));
}

export function setLayer(rows: Row[], i: number, layer: string): Row[] {
  return rows.map((r, k) => (k === i && r.cmd === '@' ? { cmd: '@', args: [layer] } : r));
}

/** Default arguments for a new command after row `after`: the cursor for absolute commands, zero for relative ones. */
function defaults(rows: Row[], after: number, cmd: string, grammar: Grammar): string[] {
  if (cmd === '@') return ['B.Cu'];
  const n = arity(cmd);
  if (!n) return [];
  const rel = cmd !== cmd.toUpperCase();
  const p = after >= 0 ? cursorAfter(rows, after, grammar) : grammar === 'svg' ? { x: 0, y: 0 } : undefined;
  if (rel || !p) return Array(n).fill('0');
  const up = cmd.toUpperCase();
  if (up === 'H') return [formatNum(p.x)];
  if (up === 'V') return [formatNum(p.y)];
  const out = Array(n).fill('0');
  if (up === 'A') out.splice(0, 2, '1', '1');
  out[n - 2] = formatNum(p.x);
  out[n - 1] = formatNum(p.y);
  return out;
}

/** Insert a command after row `after`, -1 for the front. In a route the end stays last: an insert after it goes before it. */
export function insertRow(rows: Row[], after: number, cmd: string, grammar: Grammar): Row[] {
  let at = after + 1;
  const last = rows[rows.length - 1];
  if (grammar === 'route' && last && (last.cmd.toUpperCase() === 'Z' || last.cmd === 'XZ') && at > rows.length - 1) at = rows.length - 1;
  const out = rows.slice();
  out.splice(at, 0, { cmd, args: defaults(rows, at - 1, cmd, grammar) });
  return out;
}

export function deleteRow(rows: Row[], i: number): Row[] {
  return rows.filter((_, k) => k !== i);
}

/** Change the command of a row, carrying over the numbers that still mean the same. */
export function setCommand(rows: Row[], i: number, cmd: string, grammar: Grammar): Row[] {
  const r = rows[i];
  if (!r) return rows;
  const fresh = defaults(rows, i - 1, cmd, grammar);
  const from = r.cmd.toUpperCase();
  const to = cmd.toUpperCase();
  let args = fresh;
  if (r.cmd === '@' || cmd === '@') args = fresh;
  else if (arity(cmd) === r.args.length) args = r.args.slice();
  else if (to === 'H' && (from === 'L' || from === 'X')) args = [r.args[0]];
  else if (to === 'V' && (from === 'L' || from === 'X')) args = [r.args[1]];
  else if ((to === 'L' || to === 'X') && from === 'H') args = [r.args[0], fresh[1] ?? '0'];
  else if ((to === 'L' || to === 'X') && from === 'V') args = [fresh[0] ?? '0', r.args[0]];
  return rows.map((row, k) => (k === i ? { cmd, args } : row));
}

/** Route paths: switch the end between Z, a manual track, and XZ, an automatic leg; add XZ when the end is missing. */
export function toggleEnd(rows: Row[]): Row[] {
  const last = rows[rows.length - 1];
  if (last && (last.cmd === 'Z' || last.cmd === 'z')) return [...rows.slice(0, -1), { cmd: 'XZ', args: [] }];
  if (last && last.cmd === 'XZ') return [...rows.slice(0, -1), { cmd: 'Z', args: [] }];
  return [...rows, { cmd: 'XZ', args: [] }];
}

/** The ending of a route path for the toggle: Z, XZ or none. */
export function ending(rows: Row[]): 'Z' | 'XZ' | undefined {
  const last = rows[rows.length - 1]?.cmd;
  return last === 'XZ' ? 'XZ' : last === 'Z' || last === 'z' ? 'Z' : undefined;
}
