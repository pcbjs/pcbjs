// Grids at compile: the frame a grid attaches in, its origin from a coordinate, a pad, a footprint point or a function, and its record; see docs/grids.md.
import type { Grid } from '@pcbjs/core/internal/grid'
import { gridAngle, gridPitch, isPoint, minorOf } from '@pcbjs/core/internal/grid'
import type { GridRecord, Pt } from '@pcbjs/core/model'
import type { PinRef, Src } from '@pcbjs/core/internal/types'
import { isPinRef } from '@pcbjs/core/internal/nets'
import { at as parseAt } from '@pcbjs/core/internal/units'
import { apply, invert, isMirrored, mul, placement, rotationOf, type Mat } from './geom.js'
import { CompileError, type Flat } from './flatten.js'
import type { PlaceDeps } from './deps.js'

/** A placed part as a grid reads it: its frame, its pads in board mm; null while it is not placed yet. */
export interface Anchor {
  m: Mat
  pad(p: PinRef): Pt | null
}

/** Where a grid's origin reads parts: the anchor of a part handle's part, null when not placed yet. */
export type AnchorOf = (part: unknown) => Anchor | null

/** The grid's frame on the board, mm before the pitch: `attach · T(origin) · R(angle)`; `reads` gets every part its origin read, `missing` those not placed yet. */
export function gridFrame(g: Grid, attach: Mat, anchorOf: AnchorOf, reads: unknown[]): { m: Mat; missing: boolean } {
  let missing = false
  const local = (p: Pt) => apply(invert(attach), p)
  const read = (part: unknown): Anchor | null => {
    reads.push(part)
    const a = anchorOf(part)
    if (!a) missing = true
    return a
  }
  let base = attach
  if (g.spec.frame !== undefined) {
    const a = read(g.spec.frame)
    if (a) base = a.m
  }
  const o = g.spec.origin
  let origin: Pt = [0, 0]
  if (typeof o === 'string') {
    const [x, y] = parseAt(o)
    origin = [x, y]
  } else if (isPinRef(o)) {
    const at = read(o.part)?.pad(o)
    if (at) origin = g.spec.frame !== undefined ? apply(invert(base), at) : local(at)
  } else if (isPoint(o)) {
    const a = read(o.part)
    if (a) origin = g.spec.frame !== undefined ? apply(invert(base), apply(a.m, o.at)) : local(apply(a.m, o.at))
  } else if (typeof o === 'function') {
    const toLocal = (p: Pt) => (g.spec.frame !== undefined ? apply(invert(base), p) : local(p))
    const got = o({
      pad: p => {
        const at = read(p.part)?.pad(p)
        return { at: at ? toLocal(at) : [0, 0] }
      },
      part: p => {
        const a = read(p)
        const m = a ? mul(invert(base), a.m) : base
        return { at: apply(m, [0, 0]), rot: rotationOf(m), side: isMirrored(m) ? 'B' : 'F' }
      },
    })
    const [x, y] = parseAt(got)
    origin = [x, y]
  }
  return { m: mul(base, placement(origin[0], origin[1], gridAngle(g), false)), missing }
}

/** The record of an attached grid, `used` filled once refs are final. */
export function gridRecord(g: Grid, m: Mat, frame: string | null, attach?: Src): GridRecord {
  const o = apply(m, [0, 0])
  return {
    name: g.name,
    pitch: gridPitch(g),
    minor: minorOf(g),
    ...(g.spec.maxLevel !== undefined ? { maxLevel: g.spec.maxLevel } : {}),
    origin: [round(o[0]), round(o[1])],
    angle: round(rotationOf(m)),
    mirror: isMirrored(m),
    frame,
    ...(g.src ? { src: g.src } : {}),
    ...(attach ? { attach } : {}),
    used: [],
  }
}

const round = (v: number) => Math.round(v * 1e6) / 1e6 || 0

/** The grid nodes of the dependency graph: each grid's reads, the grid it sits in, and the parts placed under it. */
export function gridDeps(flat: Pick<Flat, 'gridDeps' | 'placements'>): NonNullable<PlaceDeps['grids']> {
  return flat.gridDeps.map(d => ({
    name: d.name,
    ...(d.src ? { src: d.src } : {}),
    reads: d.reads.map(r => r.ref),
    parent: d.parent,
    parts: flat.placements.flatMap(p => (p.fp && p.grid === d.name ? [p.fp.ref] : [])),
  }))
}

/** A grid whose origin or frame reads a part the board never places is a compile error. */
export function unplacedAnchors(flat: Pick<Flat, 'gridDeps'>): void {
  const d = flat.gridDeps.find(x => x.unplaced.length)
  if (d) throw new CompileError(`the grid ${d.name} reads ${d.unplaced.join(', ')}, which this board does not place`, d.src)
}

/** The grid records with what each holds, its parts and named groups. */
export function gridsUsed(flat: Pick<Flat, 'grids' | 'placements' | 'gridDeps'>): GridRecord[] {
  return flat.grids.map(g => ({
    ...g,
    frame: flat.gridDeps.find(d => d.name === g.name)?.frame?.ref ?? null,
    used: flat.placements.flatMap(p => (p.grid !== g.name ? [] : p.fp ? [p.fp.ref] : p.group ? [p.group] : [])),
  }))
}
