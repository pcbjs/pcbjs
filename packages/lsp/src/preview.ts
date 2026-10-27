// Text is stroked in Hershey Simplex, never an SVG font; docs/ide-bridge.md describes the payload.

import { strokeText } from '@pcbjs/core/text';
import type { SiteData, SiteItem } from '@pcbjs/core/site-data';

type Pt = [number, number];
type Ring = Pt[];
type Box = { x0: number; y0: number; x1: number; y1: number };

/** What to show: the items and parts to highlight, or one part alone in its own frame. */
export interface PreviewSpec {
  /** item ids drawn as the viewer's source highlight */
  ids?: number[];
  /** footprint refs drawn selected: courtyard dashed, pads outlined */
  refs?: string[];
  /** a net drawn as the viewer's net highlight: its copper outlined, everything else faded */
  net?: string;
  /** keepout rings, board mm, outlined in the accent */
  keepouts?: Ring[][];
  /** text drawn at points in board mm, such as pad names */
  labels?: { at: Pt; text: string }[];
  /** draw this footprint alone in its own frame, x right, y down, pin 1 where the footprint puts it, with its pad numbers */
  frame?: string;
  /** with `frame`, the pad numbers outlined in the accent */
  pads?: string[];
  /** points in board mm, each marked with a ring and a cross */
  points?: Pt[];
  /** rings in board mm outlined in the accent, such as a referenced board's outline */
  outlines?: Ring[][];
}

export interface Preview {
  /** the image as a data URI */
  uri: string;
  /** the SVG text */
  svg: string;
  /** the crop in board mm, or in the footprint frame for `frame` */
  box: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
  /** the scale bar's length in mm */
  scale: number;
}

/** Display width of a preview in CSS px. */
export const WIDTH = 360;
/** The SVG units per CSS px: coordinates are whole units, half a pixel. */
const K = 2;
/** The largest SVG text, so the markdown of a hover stays under VS Code's 100 000 characters. */
const BUDGET = 56000;

const COLORS = { bg: '#14171c', board: '#1d2229', accent: '#6ea8ff', sel: '#ffcc33', net: '#ffffff', casing: '#000000', label: '#ffffff', hole: '#8b929f', keepout: '#ff5c5c', scale: '#e3e6eb' };

interface Indexed { it: SiteItem; box: Box; boxes: Box[] }
interface SiteIndex { items: Indexed[]; byId: Map<number, Indexed>; color: Map<string, string>; kind: Map<string, string>; order: Map<string, number> }

const indexes = new WeakMap<SiteData, SiteIndex>();
const caches = new WeakMap<SiteData, Map<string, Preview | null>>();

function indexOf(site: SiteData): SiteIndex {
  let ix = indexes.get(site);
  if (ix) return ix;
  const items = (site.items ?? []).map((it) => {
    const boxes = it.rings.map(boxOf);
    return { it, boxes, box: boxes.length ? boxes.reduce(union) : boxOf([]) };
  });
  ix = {
    items,
    byId: new Map(items.map((x) => [x.it.id, x])),
    color: new Map(site.layers.map((l) => [l.id, l.color])),
    kind: new Map(site.layers.map((l) => [l.id, l.kind])),
    order: new Map(site.layers.map((l) => [l.id, l.order])),
  };
  indexes.set(site, ix);
  return ix;
}

/** The preview of a spec on a board, cached per board data, which a compile replaces; undefined when nothing to show. */
export function renderPreview(site: SiteData, spec: PreviewSpec): Preview | undefined {
  let cache = caches.get(site);
  if (!cache) caches.set(site, (cache = new Map()));
  const key = JSON.stringify(spec);
  if (cache.has(key)) return cache.get(key) ?? undefined;
  let out: Preview | undefined;
  try {
    out = spec.frame ? renderFrame(site, spec.frame, spec.pads ?? []) : renderBoard(site, spec);
  } catch {
    out = undefined;
  }
  cache.set(key, out ?? null);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return out;
}

/** The pad items of a footprint with their numbers: the pad of `fp.pads` whose centre lies in the item. */
export function padItems(site: SiteData, ref: string): { item: SiteItem; num: string; name: string; at: Pt }[] {
  const fp = site.footprints.find((f) => f.ref === ref);
  if (!fp) return [];
  const out: { item: SiteItem; num: string; name: string; at: Pt }[] = [];
  const items = indexOf(site).items.filter((x) => x.it.kind === 'pad' && x.it.ref === ref);
  for (const p of fp.pads) {
    let best: Indexed | undefined, bd = Infinity;
    for (const x of items) {
      const b = x.box;
      const inside = p.at[0] >= b.x0 - 1e-3 && p.at[0] <= b.x1 + 1e-3 && p.at[1] >= b.y0 - 1e-3 && p.at[1] <= b.y1 + 1e-3;
      const d = Math.hypot((b.x0 + b.x1) / 2 - p.at[0], (b.y0 + b.y1) / 2 - p.at[1]) - (inside ? 1e3 : 0);
      if (d < bd) { bd = d; best = x; }
    }
    if (best) out.push({ item: best.it, num: p.num, name: p.name, at: p.at });
  }
  return out;
}

function renderBoard(site: SiteData, spec: PreviewSpec): Preview | undefined {
  const ix = indexOf(site);
  const hl = new Set<number>(spec.ids ?? []);
  const refs = new Set(spec.refs ?? []);
  const sel = new Set<number>();
  const crt = new Set<number>();
  for (const x of ix.items) {
    if (x.it.ref && refs.has(x.it.ref)) {
      if (x.it.kind === 'pad') sel.add(x.it.id);
      else if (ix.kind.get(x.it.layers[0]) === 'courtyard') crt.add(x.it.id);
    }
  }
  const netIds = new Set<number>();
  if (spec.net !== undefined) for (const x of ix.items) if (x.it.net === spec.net) netIds.add(x.it.id);
  let focus: Box | undefined;
  const grow = (b: Box) => (focus = focus ? union(focus, b) : { ...b });
  for (const id of [...hl, ...sel, ...crt, ...netIds]) { const x = ix.byId.get(id); if (x && isFinite(x.box.x0)) grow(x.box); }
  for (const r of refs) { const fp = site.footprints.find((f) => f.ref === r); if (fp) grow({ x0: fp.bbox.x, y0: fp.bbox.y, x1: fp.bbox.x + fp.bbox.w, y1: fp.bbox.y + fp.bbox.h }); }
  for (const k of [...(spec.keepouts ?? []), ...(spec.outlines ?? [])]) grow(boxOf(k.flat()));
  for (const [x, y] of spec.points ?? []) grow({ x0: x - 2, y0: y - 2, x1: x + 2, y1: y + 2 });
  if (!focus) return undefined;
  const crop = cropAround(focus);
  // the side the highlight is on goes on top
  const sideOf = (id: number) => ix.byId.get(id)?.it.layers.map((l) => (l.startsWith('B.') ? 'B' : l.startsWith('F.') ? 'F' : '')).find(Boolean);
  const sides = [...hl, ...sel, ...netIds].map(sideOf).filter(Boolean);
  const fpSide = [...refs].map((r) => site.footprints.find((f) => f.ref === r)?.side).find(Boolean);
  const top: 'F' | 'B' = fpSide ?? (sides.length && sides.every((s) => s === 'B') ? 'B' : 'F');
  const lit = new Set([...hl, ...sel, ...netIds]);
  const dim = lit.size > 0 || refs.size > 0 || (spec.keepouts?.length ?? 0) > 0 || (spec.points?.length ?? 0) > 0 || (spec.outlines?.length ?? 0) > 0;

  // a crop with many items starts coarser, so it is drawn once
  const many = ix.items.reduce((n, x) => n + (hits(x.box, crop) ? 1 : 0), 0);
  for (let level = many > 600 ? 2 : many > 300 ? 1 : 0; level < 4; level++) {
    const svg = drawBoard(site, ix, crop, { hl, sel, crt, netIds, lit, dim, top, spec, level });
    if (svg.length <= BUDGET || level === 3) return finish(svg, crop);
  }
  return undefined;
}

interface DrawState { hl: Set<number>; sel: Set<number>; crt: Set<number>; netIds: Set<number>; lit: Set<number>; dim: boolean; top: 'F' | 'B'; spec: PreviewSpec; level: number }

function drawBoard(site: SiteData, ix: SiteIndex, crop: Box, st: DrawState): string {
  const t = transform(crop);
  const tol = [0.6, 1.2, 2.5, 4][st.level];
  const paths = new Map<number, string>();
  const itemPath = (x: Indexed) => {
    let d = paths.get(x.it.id);
    if (d === undefined) paths.set(x.it.id, (d = x.it.rings.map((r, i) => t.ring(clipRing(r, pad(crop, 1), x.boxes[i]), tol)).join('')));
    return d;
  };
  const minSize = [0, 1, 2, 3][st.level];
  const copper = site.layers.filter((l) => l.kind === 'copper').sort((a, b) => (st.top === 'F' ? a.order - b.order : b.order - a.order));
  const silk = site.layers.find((l) => l.kind === 'silkscreen' && l.side === (st.top === 'F' ? 'front' : 'back'));
  const visible = ix.items.filter((x) => hits(x.box, crop));
  const parts: string[] = [];
  const outline = site.outline.map((r) => t.ring(clipRing(r, pad(crop, 1)), tol)).filter(Boolean).join('');
  if (outline) parts.push(`<path d='${outline}' fill='${COLORS.board}' fill-rule='evenodd'/>`);
  // a THT pad or via draws on the uppermost layer it spans
  const rank = new Map(copper.map((l, i) => [l.id, i]));
  const home = (it: SiteItem) => (it.layers.length > 1 ? it.layers.reduce((a, b) => ((rank.get(b) ?? -1) > (rank.get(a) ?? -1) ? b : a)) : it.layers[0]);
  const layerPaths = (layerId: string, color: string, opacity: number, kinds?: Set<string>) => {
    let on = '', off = '';
    for (const x of visible) {
      if ((kinds && !kinds.has(x.it.kind)) || home(x.it) !== layerId) continue;
      if (st.level && !st.lit.has(x.it.id) && Math.max(x.box.x1 - x.box.x0, x.box.y1 - x.box.y0) * t.s < minSize) continue;
      const d = itemPath(x);
      if (!d) continue;
      if (!st.dim || st.lit.has(x.it.id)) on += d;
      else off += d;
    }
    if (off) parts.push(`<path d='${off}' fill='${color}' opacity='${(opacity * 0.32).toFixed(2)}'/>`);
    if (on) parts.push(`<path d='${on}' fill='${color}' opacity='${opacity}'/>`);
  };
  copper.forEach((l, i) => layerPaths(l.id, l.color, i === copper.length - 1 ? 1 : 0.55));
  if (silk && st.level < 2) layerPaths(silk.id, silk.color, 0.8, new Set(['graphic', 'text']));
  const drills = site.drills.filter((d) => d.x + d.d / 2 >= crop.x0 && d.x - d.d / 2 <= crop.x1 && d.y + d.d / 2 >= crop.y0 && d.y - d.d / 2 <= crop.y1);
  if (drills.length) parts.push(`<path d='${drills.map((d) => circle(t.x(d.x), t.y(d.y), Math.max(1, (d.d / 2) * t.s))).join('')}' fill='${COLORS.bg}'/>`);
  const edge = site.layers.find((l) => l.kind === 'edge');
  const edgeD = site.outline.map((r) => t.ring(clipRing(r, pad(crop, 1)), tol, false)).join('');
  if (edgeD) parts.push(`<path d='${edgeD}' fill='none' stroke='${edge?.color ?? '#e6e8e3'}' stroke-width='${K}'/>`);
  const defs: string[] = [];
  const outlineOf = (ids: Set<number>, id: string, color: string, width: number, dash = false) => {
    const d = [...ids].map((i) => ix.byId.get(i)).filter((x): x is Indexed => !!x && hits(x.box, crop)).map(itemPath).join('');
    if (!d) return;
    defs.push(`<path id='${id}' d='${d}'/>`);
    parts.push(`<use href='#${id}' fill='none' stroke='${COLORS.casing}' stroke-opacity='.7' stroke-width='${width * 2 + 2}' stroke-linejoin='round'/>`);
    parts.push(`<use href='#${id}' fill='none' stroke='${color}' stroke-width='${width}' stroke-linejoin='round'${dash ? ` stroke-dasharray='${6 * K} ${4 * K}'` : ''}/>`);
  };
  // a net's pours are filled, not outlined: their edge is everywhere
  outlineOf(new Set([...st.netIds].filter((i) => ix.byId.get(i)?.it.kind !== 'zone')), 'n', COLORS.net, 2 * K);
  outlineOf(st.hl, 'h', COLORS.accent, 2 * K);
  outlineOf(st.sel, 's', COLORS.sel, 2 * K);
  if (st.crt.size) {
    // a courtyard is a stroked outline: dash its outer ring as the viewer does
    const d = [...st.crt].map((i) => ix.byId.get(i)).filter((x): x is Indexed => !!x).map((x) => {
      const i = x.boxes.reduce((m, b, k) => ((b.x1 - b.x0) * (b.y1 - b.y0) > (x.boxes[m].x1 - x.boxes[m].x0) * (x.boxes[m].y1 - x.boxes[m].y0) ? k : m), 0);
      return t.ring(x.it.rings[i], tol);
    }).join('');
    if (d) parts.push(`<path d='${d}' fill='none' stroke='${COLORS.casing}' stroke-opacity='.7' stroke-width='${4 * K}'/><path d='${d}' fill='none' stroke='${COLORS.sel}' stroke-width='${1.5 * K}' stroke-dasharray='${6 * K} ${4 * K}'/>`);
  } else {
    for (const r of st.spec.refs ?? []) {
      const fp = site.footprints.find((f) => f.ref === r);
      if (!fp) continue;
      const b = fp.bbox;
      const rect = `M${t.x(b.x - 0.25)} ${t.y(b.y - 0.25)}H${t.x(b.x + b.w + 0.25)}V${t.y(b.y + b.h + 0.25)}H${t.x(b.x - 0.25)}Z`;
      parts.push(`<path d='${rect}' fill='none' stroke='${COLORS.casing}' stroke-opacity='.7' stroke-width='${4 * K}'/><path d='${rect}' fill='none' stroke='${COLORS.sel}' stroke-width='${1.5 * K}' stroke-dasharray='${6 * K} ${4 * K}'/>`);
    }
  }
  for (const k of st.spec.keepouts ?? []) {
    const d = k.map((r) => t.ring(clipRing(r, pad(crop, 1)), tol)).join('');
    if (d) parts.push(`<path d='${d}' fill='${COLORS.accent}' fill-opacity='.18' fill-rule='evenodd' stroke='${COLORS.accent}' stroke-width='${2 * K}' stroke-dasharray='${5 * K} ${3 * K}'/>`);
  }
  for (const k of site.keepouts ?? []) {
    if (st.spec.keepouts?.some((s) => s === k.outline)) continue;
    if (!hits(boxOf(k.outline.flat()), crop)) continue;
    const d = k.outline.map((r) => t.ring(clipRing(r, pad(crop, 1)), tol)).join('');
    if (d) parts.push(`<path d='${d}' fill='none' stroke='${COLORS.keepout}' stroke-opacity='.6' stroke-width='${K}' stroke-dasharray='${3 * K} ${3 * K}'/>`);
  }
  for (const o of st.spec.outlines ?? []) {
    const d = o.map((r) => t.ring(clipRing(r, pad(crop, 1)), tol)).join('');
    if (d) parts.push(`<path d='${d}' fill='none' stroke='${COLORS.casing}' stroke-opacity='.7' stroke-width='${4 * K}'/><path d='${d}' fill='none' stroke='${COLORS.accent}' stroke-width='${2 * K}' stroke-dasharray='${6 * K} ${4 * K}'/>`);
  }
  for (const [x, y] of st.spec.points ?? []) {
    const cx = t.x(x), cy = t.y(y), r = 7 * K, a = 11 * K;
    const d = `${circle(cx, cy, r)}M${cx - a} ${cy}H${cx + a}M${cx} ${cy - a}V${cy + a}`;
    parts.push(`<path d='${d}' fill='none' stroke='${COLORS.casing}' stroke-opacity='.7' stroke-width='${4 * K}'/><path d='${d}' fill='none' stroke='${COLORS.accent}' stroke-width='${1.5 * K}'/>`);
  }
  parts.push(labels(st.spec.labels ?? [], t, 0.9 / t.s * 11));
  parts.push(scaleBar(t));
  return svgDoc(t, defs, parts);
}

function renderFrame(site: SiteData, ref: string, outlined: string[]): Preview | undefined {
  const asked = site.footprints.find((f) => f.ref === ref);
  if (!asked) return undefined;
  // the instance that reads best: one of the same footprint placed unrotated on the front, else the one asked for
  const fp = site.footprints.find((f) => f.id === asked.id && f.rot === 0 && f.side === 'F') ?? site.footprints.find((f) => f.id === asked.id && f.rot === 0) ?? asked;
  ref = fp.ref;
  const ix = indexOf(site);
  const rad = (fp.rot * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  // board = at + R(rot) mirror(local), counter-clockwise on the screen; back to the footprint's own frame
  const local = ([x, y]: Pt): Pt => {
    const dx = x - fp.at[0], dy = y - fp.at[1];
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    return [fp.side === 'B' ? -lx : lx, ly];
  };
  const front = (l: string) => (l.startsWith('B.') ? `F.${l.slice(2)}` : l);
  const mine = ix.items.filter((x) => x.it.ref === ref).map((x) => ({ it: x.it, rings: x.it.rings.map((r) => r.map(local)) }));
  if (!mine.length) return undefined;
  const all = mine.flatMap((m) => m.rings.flat());
  const crop = cropAround(boxOf(all), 0.6);
  const pads = padItems(site, ref);
  const minPad = Math.min(...pads.map((p) => { const b = boxOf(p.item.rings.flat()); return Math.min(b.x1 - b.x0, b.y1 - b.y0); }), 2);
  for (let level = 0; level < 4; level++) {
    const t = transform(crop);
    const tol = [0.6, 1.2, 2.5, 4][level];
    const parts: string[] = [];
    const color = (l: string) => site.layers.find((x) => x.id === front(l))?.color ?? '#c83434';
    const groups = new Map<string, string>();
    const layerOf = (it: SiteItem) => (it.kind === 'pad' ? 'F.Cu' : front(it.layers[0] ?? ''));
    const ORDER = ['F.Fab', 'F.CrtYd', 'F.Cu', 'F.SilkS'];
    for (const m of mine) {
      const l = layerOf(m.it);
      if (!ORDER.includes(l) || (level >= 2 && l === 'F.Fab')) continue;
      const d = m.rings.map((r) => t.ring(r, tol)).join('');
      groups.set(l, (groups.get(l) ?? '') + d);
    }
    for (const l of ORDER) if (groups.get(l)) parts.push(`<path d='${groups.get(l)}' fill='${color(l)}' opacity='${l === 'F.Cu' ? 1 : 0.85}'/>`);
    const hl = pads.filter((p) => outlined.includes(p.num)).map((p) => p.item.rings.map((r) => t.ring(r.map(local), tol)).join('')).join('');
    if (hl) parts.push(`<path d='${hl}' fill='none' stroke='${COLORS.casing}' stroke-opacity='.7' stroke-width='${6 * K}' stroke-linejoin='round'/><path d='${hl}' fill='none' stroke='${COLORS.accent}' stroke-width='${2 * K}' stroke-linejoin='round'/>`);
    const drills = site.drills.filter((d) => d.x >= fp.bbox.x - 0.01 && d.x <= fp.bbox.x + fp.bbox.w + 0.01 && d.y >= fp.bbox.y - 0.01 && d.y <= fp.bbox.y + fp.bbox.h + 0.01);
    if (drills.length) parts.push(`<path d='${drills.map((d) => { const p = local([d.x, d.y]); return circle(t.x(p[0]), t.y(p[1]), Math.max(1, (d.d / 2) * t.s)); }).join('')}' fill='${COLORS.bg}' stroke='${COLORS.hole}' stroke-width='${K}'/>`);
    parts.push(`<path d='M${t.x(0) - 6 * K} ${t.y(0)}H${t.x(0) + 6 * K}M${t.x(0)} ${t.y(0) - 6 * K}V${t.y(0) + 6 * K}' stroke='${COLORS.scale}' stroke-opacity='.6' stroke-width='${K}'/>`);
    const named = pads.filter((p) => p.num);
    const size = Math.min(Math.max(minPad * 0.5, 9 / t.s), 1.4);
    parts.push(labels(named.map((p) => ({ at: local(p.at), text: p.num })), t, size));
    parts.push(scaleBar(t));
    const svg = svgDoc(t, [], parts);
    if (svg.length <= BUDGET || level === 3) return finish(svg, crop);
  }
  return undefined;
}

interface Transform { s: number; box: Box; w: number; h: number; x(v: number): number; y(v: number): number; ring(r: Ring, tol: number, close?: boolean): string }

/** Board mm to SVG units: the crop scaled to WIDTH * K units across, whole units. */
function transform(box: Box): Transform {
  const s = (WIDTH * K) / (box.x1 - box.x0);
  const w = WIDTH * K, h = Math.round((box.y1 - box.y0) * s);
  const x = (v: number) => Math.round((v - box.x0) * s);
  const y = (v: number) => Math.round((v - box.y0) * s);
  return {
    s, box, w, h, x, y,
    ring(r, tol, close = true) {
      const n = r.length;
      if (n < 2) return '';
      const xs: number[] = [], ys: number[] = [];
      for (let i = 0; i < n; i++) {
        const X = Math.round((r[i][0] - box.x0) * s), Y = Math.round((r[i][1] - box.y0) * s), m = xs.length;
        if (m && xs[m - 1] === X && ys[m - 1] === Y) continue;
        xs.push(X); ys.push(Y);
      }
      if (close && xs.length > 2 && xs[0] === xs[xs.length - 1] && ys[0] === ys[ys.length - 1]) { xs.pop(); ys.pop(); }
      if (xs.length < (close ? 3 : 2)) return '';
      const keep = simplify(xs, ys, tol);
      let d = '', first = true;
      for (let i = 0; i < xs.length; i++) {
        if (!keep[i]) continue;
        d += first ? `M${xs[i]}${num(ys[i])}L` : `${num(xs[i])}${num(ys[i])}`;
        first = false;
      }
      return close ? `${d}Z` : d;
    },
  };
}


/** Douglas-Peucker at `tol` units over points in whole units: which to keep. */
function simplify(xs: number[], ys: number[], tol: number): Uint8Array {
  const n = xs.length;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  if (n <= 4) return keep.fill(1);
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!, a = stack.pop()!;
    let best = -1, bd = tol;
    const ax = xs[a], ay = ys[a], dx = xs[b] - ax, dy = ys[b] - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((xs[i] - ax) * dy - (ys[i] - ay) * dx) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push(a, best, best, b); }
  }
  return keep;
}

/** A number of path data after another: a space unless its sign separates it. */
const num = (v: number) => (v < 0 ? `${v}` : ` ${v}`);

/** A ring clipped to a box, Sutherland-Hodgman: inside the box a point is inside the result exactly when it is inside the ring. */
function clipRing(r: Ring, b: Box, rb = boxOf(r)): Ring {
  if (rb.x0 >= b.x0 && rb.x1 <= b.x1 && rb.y0 >= b.y0 && rb.y1 <= b.y1) return r;
  let pts = r;
  const edges: [(p: Pt) => boolean, (p: Pt, q: Pt) => Pt][] = [
    [(p) => p[0] >= b.x0, (p, q) => [b.x0, p[1] + ((q[1] - p[1]) * (b.x0 - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= b.x1, (p, q) => [b.x1, p[1] + ((q[1] - p[1]) * (b.x1 - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= b.y0, (p, q) => [p[0] + ((q[0] - p[0]) * (b.y0 - p[1])) / (q[1] - p[1]), b.y0]],
    [(p) => p[1] <= b.y1, (p, q) => [p[0] + ((q[0] - p[0]) * (b.y1 - p[1])) / (q[1] - p[1]), b.y1]],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const next: Ring = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const pi = inside(p), qi = inside(q);
      if (pi) next.push(p);
      if (pi !== qi) next.push(cut(p, q));
    }
    pts = next;
  }
  return pts;
}

/** Labels in the stroke font, centred on their points, white over a dark casing. `size` is the cap height in mm. */
function labels(ls: { at: Pt; text: string }[], t: Transform, size: number): string {
  if (!ls.length) return '';
  let d = '';
  for (const l of ls.slice(0, 64)) {
    const st = strokeText(l.text, { size, thickness: size * 0.15, anchor: 'middle' });
    for (const s of st.strokes) {
      const pts = s.map(([x, y]) => [t.x(l.at[0] + x), t.y(l.at[1] + y + size / 2)] as Pt);
      d += `M${pts[0][0]} ${pts[0][1]}${pts.length > 1 ? `L${pts.slice(1).map((p) => `${p[0]} ${p[1]}`).join(' ')}` : ''}`;
    }
  }
  const w = Math.max(1.2 * K, size * 0.16 * t.s);
  return `<path d='${d.replace(/ -/g, '-')}' fill='none' stroke='${COLORS.casing}' stroke-opacity='.75' stroke-width='${(w + 2 * K).toFixed(1)}' stroke-linecap='round' stroke-linejoin='round'/><path d='${d.replace(/ -/g, '-')}' fill='none' stroke='${COLORS.label}' stroke-width='${w.toFixed(1)}' stroke-linecap='round' stroke-linejoin='round'/>`;
}

/** The scale bar in the lower left: 1 mm, or the shortest of 2, 5, 10 and 20 mm that is at least 24 px long. */
function scaleBar(t: Transform): string {
  const mm = [1, 2, 5, 10, 20].find((v) => v * t.s >= 24 * K) ?? 20;
  const len = Math.round(mm * t.s);
  const x = 8 * K, y = t.h - 8 * K;
  const text = strokeText(`${mm} mm`, { size: 1, thickness: 0.15, anchor: 'start' });
  const k = (9 * K) / 1;
  const tx = x + len + 5 * K;
  const glyphs = text.strokes.map((s) => `M${s.map(([a, b]) => `${Math.round(tx + a * k)} ${Math.round(y + b * k + 4.5 * K)}`).join(' ').replace(/^(\S+ \S+)/, '$1L')}`).join('');
  const bar = `M${x} ${y - 3 * K}V${y + 3 * K}M${x} ${y}H${x + len}M${x + len} ${y - 3 * K}V${y + 3 * K}`;
  return `<path d='${bar}${glyphs}' fill='none' stroke='${COLORS.casing}' stroke-opacity='.7' stroke-width='${4 * K}' stroke-linecap='round'/><path d='${bar}${glyphs}' fill='none' stroke='${COLORS.scale}' stroke-width='${1.5 * K}' stroke-linecap='round' stroke-linejoin='round'/>`;
}

function svgDoc(t: Transform, defs: string[], parts: string[]): string {
  const b = t.box;
  // data-box: the crop in mm, board or footprint frame, for a client or a test
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${WIDTH}' height='${Math.round(t.h / K)}' viewBox='0 0 ${t.w} ${t.h}' data-box='${[b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0].map(round3).join(' ')}'>${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<rect width='${t.w}' height='${t.h}' rx='${4 * K}' fill='${COLORS.bg}'/>${parts.join('')}</svg>`;
}

function finish(svg: string, crop: Box): Preview {
  const t = transform(crop);
  const mm = [1, 2, 5, 10, 20].find((v) => v * t.s >= 24 * K) ?? 20;
  return {
    svg,
    uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    box: { x: round3(crop.x0), y: round3(crop.y0), w: round3(crop.x1 - crop.x0), h: round3(crop.y1 - crop.y0) },
    width: WIDTH,
    height: Math.round(t.h / K),
    scale: mm,
  };
}

/** The crop around a box: a margin, at least 4 mm across, between 1:3 and 1:2 high to wide, so a hover of 250 px still shows the text, then a strip below for the scale bar. */
function cropAround(b: Box, margin = 1.2): Box {
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const m = Math.max(margin, Math.min(0.15 * Math.max(w, h), 2.5));
  let x0 = b.x0 - m, x1 = b.x1 + m, y0 = b.y0 - m, y1 = b.y1 + m;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let W = Math.max(x1 - x0, 4), H = y1 - y0;
  if (H > W * 0.5) W = H / 0.5;
  if (H < W / 3) H = W / 3;
  x0 = cx - W / 2; x1 = cx + W / 2; y0 = cy - H / 2; y1 = cy + H / 2;
  // room for the scale bar: 18 px at the bottom
  y1 += (18 / WIDTH) * W;
  return { x0, y0, x1, y1 };
}

const circle = (x: number, y: number, r: number) => { const q = Math.max(1, Math.round(r)); return `M${x - q} ${y}a${q} ${q} 0 1 0 ${2 * q} 0a${q} ${q} 0 1 0 ${-2 * q} 0Z`; };
const pad = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const hits = (a: Box, b: Box) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function boxOf(pts: Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
