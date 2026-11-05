// model frame: mm, centred on the body, x along the footprint's x, y along its -y, z up from the board face
// a change to a body's geometry bumps MODELS_VERSION in @pcbjs/export's models.ts, which keys the cached meshes
import * as THREE from 'three'
import type { GeneratedSpec, ModelSpec } from '@pcbjs/core/internal/types'
import type { StepModel } from '@pcbjs/step/internal/mesh'
import { formatValue, parseFarads, parseOhms, resistorCode } from '@pcbjs/lib/internal/values'
import { chipModel, markingDecal } from './chip'
import { ledModel } from './led'
import { headerModel } from './header'
import { sot23Model } from './sot23'
import { boxModel } from './box'
import { stepMaterial } from './materials'
import { Sink } from './sink'

export { composeModel, type ModelPart, type ModelMaterial } from './compose'

/** What a generated body reads besides its spec, as @pcbjs/export's modelHash keys it. */
export interface ModelCtx {
  /** the footprint's body height above the board, mm, which a header and a SOT-23 take */
  height: number
  /** board thickness, mm, which a header's pins pass through */
  thickness: number
}

/** What the printed code reads: the part's value and fields. */
export interface PartText {
  value: string
  fields: Record<string, string>
}

// the EIA size class resistorCode reads, from the body length: 0402 and smaller unmarked, 0603 with EIA-96
const eiaSize = (length: number) => (length <= 1.0 ? '0402' : length <= 1.6 ? '0603' : '0805')

/** The code printed on the part: the spec's own marking, else for a resistor the code from its value and tolerance. */
export function markingFor(spec: ModelSpec, part: PartText): string {
  if (spec.kind !== 'chip') return ''
  if (spec.marking !== undefined) return spec.marking
  if (spec.part !== 'R') return ''
  const ohms = parseOhms(part.value)
  return ohms === null ? '' : resistorCode(ohms, eiaSize(spec.body[0]), part.fields?.tolerance)
}

/** A line for the tooltip: the parsed value and, for a resistor, its printed code. */
export function describe(spec: ModelSpec | undefined, part: PartText): string {
  if (spec?.kind !== 'chip') return ''
  if (spec.part === 'R') {
    const ohms = parseOhms(part.value)
    if (ohms === null) return ''
    const code = markingFor(spec, part)
    return `${formatValue(ohms, 'Ω')}, ${code ? `printed ${code}` : 'unmarked'}`
  }
  if (spec.part === 'C') {
    const f = parseFarads(part.value)
    return f === null ? '' : formatValue(f, 'F')
  }
  return ''
}

function build(spec: GeneratedSpec, ctx: ModelCtx): THREE.Object3D {
  switch (spec.kind) {
    case 'chip':
      return chipModel(spec)
    case 'led':
      return ledModel(spec)
    case 'header':
      return headerModel(spec, ctx.height, ctx.thickness)
    case 'sot23':
      return sot23Model(spec, ctx.height)
    case 'ic':
      return boxModel(spec)
  }
}

const keyOf = (spec: GeneratedSpec, ctx: ModelCtx) => JSON.stringify([spec, ctx.height, ctx.thickness])
const meshes = new Map<string, StepModel>()

/** A generated body as meshes in the model frame, one per colour; three.js only, so it runs in Node as in the browser. */
export function modelMeshes(spec: GeneratedSpec, ctx: ModelCtx): StepModel {
  const key = keyOf(spec, ctx)
  let m = meshes.get(key)
  if (!m) {
    const sink = new Sink()
    sink.addObject(build(spec, ctx))
    meshes.set(key, (m = { meshes: sink.meshes() }))
  }
  return m
}

const protos = new Map<string, THREE.Group>()

/** The live view's body: the meshes of modelMeshes in their materials, with a resistor's printed code as a decal. */
export function generatedModel(spec: GeneratedSpec, ctx: ModelCtx, marking: string): THREE.Object3D {
  const key = `${keyOf(spec, ctx)}${marking}`
  let proto = protos.get(key)
  if (!proto) {
    proto = new THREE.Group()
    for (const m of modelMeshes(spec, ctx).meshes) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
      geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
      geo.computeBoundingSphere()
      proto.add(new THREE.Mesh(geo, stepMaterial(m.color, m.material)))
    }
    if (spec.kind === 'chip' && marking) proto.add(markingDecal(spec, marking))
    protos.set(key, proto)
  }
  return proto.clone()
}
