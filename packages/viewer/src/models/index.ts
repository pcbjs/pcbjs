// model frame: mm, centred on the body, x along the footprint's x, y along its -y, z up from the board face
import * as THREE from 'three'
import type { ModelSpec } from '@pcbjs/core/types'
import { formatValue, parseFarads, parseOhms, resistorCode } from '@pcbjs/lib/values'
import { chipModel } from './chip'
import { ledModel } from './led'
import { headerModel } from './header'
import { sot23Model } from './sot23'
import { boxModel } from './box'
import { missingModel } from './missing'

export interface ModelCtx {
  value: string
  fields: Record<string, string>
  body: { x: number; y: number; w: number; h: number; rot: number }
  /** body height above the board, mm */
  height: number
  /** board thickness, mm, for parts that pass through it */
  thickness: number
}

const cache = new Map<string, THREE.Object3D>()

/** The code printed on the part: the spec's own marking, else for a resistor the code from its value and tolerance. */
export function markingFor(spec: ModelSpec, ctx: Pick<ModelCtx, 'value' | 'fields'>): string {
  if (spec.kind !== 'chip') return ''
  if (spec.marking !== undefined) return spec.marking
  if (spec.part !== 'R') return ''
  const ohms = parseOhms(ctx.value)
  return ohms === null ? '' : resistorCode(ohms, spec.size, ctx.fields?.tolerance)
}

/** A line for the tooltip: the parsed value and, for a resistor, its printed code. */
export function describe(spec: ModelSpec | undefined, ctx: Pick<ModelCtx, 'value' | 'fields'>): string {
  if (spec?.kind !== 'chip') return ''
  if (spec.part === 'R') {
    const ohms = parseOhms(ctx.value)
    if (ohms === null) return ''
    const code = markingFor(spec, ctx)
    return `${formatValue(ohms, 'Ω')}, ${code ? `printed ${code}` : 'unmarked'}`
  }
  if (spec.part === 'C') {
    const f = parseFarads(ctx.value)
    return f === null ? '' : formatValue(f, 'F')
  }
  return ''
}

function build(spec: ModelSpec, ctx: ModelCtx, marking: string): THREE.Object3D {
  switch (spec.kind) {
    case 'chip':
      return chipModel(spec, ctx.height, marking)
    case 'led':
      return ledModel(spec, ctx.height)
    case 'header':
      return headerModel(spec, ctx.height, ctx.thickness)
    case 'sot23':
      return sot23Model(spec, ctx.height)
    case 'ic':
      return boxModel(spec)
    case 'box':
      return missingModel(spec.w, spec.h, spec.height, '')
    case 'none':
      return new THREE.Group()
    default: {
      const s = spec as { kind?: string }
      console.warn(`3D view: no generator for model kind ${JSON.stringify(s.kind)}, drawing its outline`)
      return missingModel(ctx.body.w, ctx.body.h, ctx.height, '')
    }
  }
}

export function getModel(spec: ModelSpec, ctx: ModelCtx): THREE.Object3D {
  const marking = markingFor(spec, ctx)
  // the height and thickness change the shape of most parts, so they are part of the key
  const key = JSON.stringify([spec, marking, ctx.height, spec.kind === 'header' ? ctx.thickness : 0])
  let proto = cache.get(key)
  if (!proto) {
    proto = build(spec, ctx, marking)
    cache.set(key, proto)
  }
  return proto.clone()
}
