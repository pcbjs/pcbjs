export const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i;

/** mm per unit, the input units of pcbjs. A bare number is mm. */
export const LENGTH_UNITS: Record<string, number> = { '': 1, mm: 1, cm: 10, m: 1000, mil: 0.0254, th: 0.0254, in: 25.4, um: 0.001, nm: 1e-6 };
/** degrees per unit. A bare number is degrees. */
export const ANGLE_UNITS: Record<string, number> = { '': 1, deg: 1, '°': 1, rad: 180 / Math.PI, turn: 360 };

/** A number token as written: `12.5mm` is { num: 12.5, unit: 'mm' }. */
export interface Token {
  num: number;
  unit: string;
}

export function parseToken(s: string): Token | undefined {
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-zA-Z°]*)$/i.exec(s.trim());
  if (!m) return undefined;
  return { num: parseFloat(m[1]), unit: m[2] };
}

/** A number without float noise: at most `digits` decimals, no trailing zeros, never `-0`. */
export function formatNum(n: number, digits = 4): string {
  const r = parseFloat(n.toFixed(digits));
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}

export function formatToken(t: Token): string {
  return formatNum(t.num) + t.unit;
}

export function lengthMm(t: Token): number | undefined {
  const k = LENGTH_UNITS[t.unit.toLowerCase()];
  return k === undefined ? undefined : t.num * k;
}

export function angleDeg(t: Token): number | undefined {
  const k = ANGLE_UNITS[t.unit.toLowerCase()];
  return k === undefined ? undefined : t.num * k;
}

/** The token with `mm` millimetres, in the unit it was written in. */
export function withMm(t: Token, mm: number): Token {
  const k = LENGTH_UNITS[t.unit.toLowerCase()] ?? 1;
  return { num: mm / k, unit: t.unit };
}

export function withDeg(t: Token, deg: number): Token {
  const k = ANGLE_UNITS[t.unit.toLowerCase()] ?? 1;
  return { num: deg / k, unit: t.unit };
}

export interface AtValue {
  x: Token;
  y: Token;
  rot?: Token;
  /** The separator between fields as written, a space by default. */
  sep: string;
}

export function parseAt(s: string): AtValue | undefined {
  const trimmed = s.trim();
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return undefined;
  const toks = parts.map(parseToken);
  if (toks.some((t) => !t)) return undefined;
  const [x, y, rot] = toks as Token[];
  if (lengthMm(x) === undefined || lengthMm(y) === undefined || (rot && angleDeg(rot) === undefined)) return undefined;
  const sep = /^[^\s,]+([\s,]+)/.exec(trimmed)?.[1] ?? ' ';
  return rot ? { x, y, rot, sep } : { x, y, sep };
}

export function formatAt(a: AtValue): string {
  const parts = [formatToken(a.x), formatToken(a.y)];
  if (a.rot) parts.push(formatToken(a.rot));
  return parts.join(a.sep);
}

/** Move by dx, dy millimetres, each field in its own unit. */
export function nudgeAt(a: AtValue, dx: number, dy: number): AtValue {
  return { ...a, x: withMm(a.x, (lengthMm(a.x) ?? 0) + dx), y: withMm(a.y, (lengthMm(a.y) ?? 0) + dy) };
}

/** Turn by `by` degrees, normalised to [0, 360). A missing rotation is added in the style of the other fields. */
export function rotateAt(a: AtValue, by: number): AtValue {
  const cur = a.rot ?? { num: 0, unit: a.x.unit || a.y.unit ? 'deg' : '' };
  const deg = ((((angleDeg(cur) ?? 0) + by) % 360) + 360) % 360;
  return { ...a, rot: withDeg(cur, deg) };
}

/** Set one field from what the user typed: a bare number keeps the unit of the field, a number with a unit replaces it. */
export function setAtField(a: AtValue, field: 'x' | 'y' | 'rot', typed: string): AtValue | undefined {
  const t = parseToken(typed);
  if (!t) return undefined;
  const old = field === 'rot' ? a.rot ?? { num: 0, unit: a.x.unit || a.y.unit ? 'deg' : '' } : a[field];
  const next = t.unit ? t : { num: t.num, unit: old.unit };
  if (field === 'rot' ? angleDeg(next) === undefined : lengthMm(next) === undefined) return undefined;
  return { ...a, [field]: next };
}

export interface PointValue {
  x: Token;
  y: Token;
  layer?: string;
  sep: string;
}

export function parsePoint(s: string): PointValue | undefined {
  const trimmed = s.trim();
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return undefined;
  const x = parseToken(parts[0]);
  const y = parseToken(parts[1]);
  if (!x || !y || lengthMm(x) === undefined || lengthMm(y) === undefined) return undefined;
  const sep = /^[^\s,]+([\s,]+)/.exec(trimmed)?.[1] ?? ' ';
  return parts[2] ? { x, y, layer: parts[2], sep } : { x, y, sep };
}

export function formatPoint(p: PointValue): string {
  const parts = [formatToken(p.x), formatToken(p.y)];
  if (p.layer) parts.push(p.layer);
  return parts.join(p.sep);
}

/** True when a route end string is a coordinate: its first token is a number. `"D1.K"` is a pad. */
export function isCoordinate(s: string): boolean {
  return NUM_RE.test(s.trim()) && !!parsePoint(s);
}

const SIDE_FLIP: Record<string, string> = { f: 'B', b: 'F', top: 'bottom', bottom: 'top', front: 'back', back: 'front' };

/** F to B and back, keeping the spelling family and case: top and bottom, front and back. */
export function toggleSide(s: string): string | undefined {
  const flip = SIDE_FLIP[s.toLowerCase()];
  if (!flip) return undefined;
  if (s.length === 1) return s === s.toLowerCase() ? flip.toLowerCase() : flip;
  if (s === s.toUpperCase()) return flip.toUpperCase();
  if (s[0] === s[0].toUpperCase()) return flip[0].toUpperCase() + flip.slice(1);
  return flip;
}

export interface LayerInfo {
  name: string;
  aliases: string[];
  copper: boolean;
}

export const STANDARD_LAYERS: LayerInfo[] = [
  { name: 'F.Cu', aliases: ['top', 'front'], copper: true },
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ name: `In${i}.Cu`, aliases: [], copper: true })),
  { name: 'B.Cu', aliases: ['bottom', 'back'], copper: true },
  { name: 'F.SilkS', aliases: ['silk', 'F.Silk', 'F.Silkscreen'], copper: false },
  { name: 'B.SilkS', aliases: ['B.Silk', 'B.Silkscreen'], copper: false },
  { name: 'F.Mask', aliases: [], copper: false },
  { name: 'B.Mask', aliases: [], copper: false },
  { name: 'F.Paste', aliases: [], copper: false },
  { name: 'B.Paste', aliases: [], copper: false },
  { name: 'Edge.Cuts', aliases: ['edge', 'outline', 'Edge.Cut'], copper: false },
  { name: 'F.CrtYd', aliases: ['F.Courtyard'], copper: false },
  { name: 'B.CrtYd', aliases: ['B.Courtyard'], copper: false },
  { name: 'F.Fab', aliases: [], copper: false },
  { name: 'B.Fab', aliases: [], copper: false },
  { name: 'Dwgs.User', aliases: ['User.Drawings'], copper: false },
  { name: 'Cmts.User', aliases: ['User.Comments'], copper: false },
];

/** The layers to offer: the board's own when the server reported them, else the standard set. Copper only when asked. */
export function layerChoices(boardLayers: string[] | undefined, copperOnly: boolean): LayerInfo[] {
  let list = STANDARD_LAYERS;
  if (boardLayers?.length) {
    list = boardLayers.map((name) => STANDARD_LAYERS.find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? { name, aliases: [], copper: /\.Cu$/i.test(name) });
  }
  return copperOnly ? list.filter((l) => l.copper) : list;
}

/** The canonical name of a layer or alias, case-insensitive, undefined when unknown. */
export function canonicalLayer(name: string): string | undefined {
  const n = name.toLowerCase();
  return STANDARD_LAYERS.find((l) => l.name.toLowerCase() === n || l.aliases.some((a) => a.toLowerCase() === n))?.name;
}

export interface Range {
  min: number;
  max: number;
  step: number;
}

const TRACKISH = new Set(['track', 'route', 'via', 'zone']);

/** Slider range in mm for a numeric kind, by the element or call it sits on, widened to include the current value. */
export function numericRange(kind: string, owner: string | undefined, current?: number): Range {
  const o = (owner ?? '').toLowerCase();
  let r: [number, number];
  if (kind === 'width') r = TRACKISH.has(o) ? [0.1, 2] : [0.05, 2];
  else if (kind === 'size') r = o === 'text' ? [0.5, 5] : o === 'pad' || o === 'via' ? [0.2, 5] : [0.1, 10];
  else if (kind === 'drill') r = [0.2, 3];
  else if (kind === 'thickness') r = o === 'pcb' || o === 'board' ? [0.4, 3.2] : [0.05, 1];
  else r = [0, 10];
  let [min, max] = r;
  if (current !== undefined && Number.isFinite(current)) {
    if (current < min) min = Math.max(0, Math.floor(current * 20) / 20);
    if (current > max) max = Math.ceil(current * 20) / 20;
  }
  return { min, max, step: 0.05 };
}
