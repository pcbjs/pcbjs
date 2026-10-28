// 2-layer defaults: FR4 1.6 mm, 1 oz, 0.01 mm mask, er 4.5, tan 0.02.
import type { Finish, Stackup, StackupLayer } from './types.js'

/** 1 oz of copper per square foot is 0.035 mm thick. */
export const OZ = 0.035

export interface StackupOptions {
  /** total thickness, mm (default 1.6) */
  thickness?: number
  /** outer copper weight, oz (default 1) */
  outerCopper?: number
  /** inner copper weight, oz (default 0.5) */
  innerCopper?: number
  /** prepreg between an outer and the first inner layer, mm (default 0.2; 0.15 on 8 layers) */
  prepreg?: number
  finish?: Finish
  /** default "Green" */
  maskColor?: string
  /** default "White" */
  silkColor?: string
  /** default "FR4" */
  material?: string
  /** default 4.5 */
  er?: number
  /** default 0.02 */
  lossTangent?: number
}

const MASK = 0.01
const r4 = (v: number) => Math.round(v * 1e4) / 1e4

function build(copper: 2 | 4 | 6 | 8, o: StackupOptions = {}): Stackup {
  const total = o.thickness ?? 1.6
  const outer = r4((o.outerCopper ?? 1) * OZ),
    inner = r4((o.innerCopper ?? 0.5) * OZ)
  const maskColor = o.maskColor ?? 'Green',
    silkColor = o.silkColor ?? 'White'
  const diel = { material: o.material ?? 'FR4', er: o.er ?? 4.5, lossTangent: o.lossTangent ?? 0.02 }
  // n/2 prepregs and n/2 - 1 cores alternate between the n copper layers
  const prepregs = copper / 2,
    cores = copper / 2 - 1
  const pp = copper === 2 ? 0 : (o.prepreg ?? (copper === 8 ? 0.15 : 0.2))
  const rest = total - 2 * MASK - 2 * outer - (copper - 2) * inner - prepregs * pp
  const core = r4(copper === 2 ? rest : rest / cores)
  if (!(core > 0.05)) throw new Error(`a ${copper}-layer stackup ${total} mm thick leaves no room for the cores (${core} mm each)`)
  const cu = (name: string, t: number, oz: number): StackupLayer => ({ type: 'copper', name: name as any, thickness: t, weight: oz })
  const layers: StackupLayer[] = [
    { type: 'silk', side: 'F', color: silkColor },
    { type: 'paste', side: 'F' },
    { type: 'mask', side: 'F', thickness: MASK, color: maskColor },
    cu('F.Cu', outer, o.outerCopper ?? 1),
  ]
  for (let i = 1; i < copper; i++) {
    const isPrepreg = copper > 2 && i % 2 === 1
    layers.push(isPrepreg ? { type: 'prepreg', thickness: pp, ...diel } : { type: 'core', thickness: core, ...diel })
    layers.push(i === copper - 1 ? cu('B.Cu', outer, o.outerCopper ?? 1) : cu(`In${i}.Cu`, inner, o.innerCopper ?? 0.5))
  }
  layers.push({ type: 'mask', side: 'B', thickness: MASK, color: maskColor }, { type: 'paste', side: 'B' }, { type: 'silk', side: 'B', color: silkColor })
  const s: Stackup = { layers, maskColor, silkColor, thickness: total }
  if (o.finish) s.finish = o.finish
  return s
}

/** Two copper layers on one core: 1.6 mm, 1 oz, FR4. */
export const twoLayer = (opts?: StackupOptions): Stackup => build(2, opts)
/** Four layers: prepreg, core, prepreg, the JLC04161H-7628 shape: 0.2 mm prepregs, about 1.06 mm core, 1 oz outer, 0.5 oz inner. */
export const fourLayer = (opts?: StackupOptions): Stackup => build(4, opts)
/** Six layers, symmetric: three 0.2 mm prepregs and two equal cores, about 0.42 mm each at 1.6 mm. */
export const sixLayer = (opts?: StackupOptions): Stackup => build(6, opts)
/** Eight layers, symmetric: four 0.15 mm prepregs and three equal cores, about 0.27 mm each at 1.6 mm. */
export const eightLayer = (opts?: StackupOptions): Stackup => build(8, opts)

/** The stackup the compiler generates for `copper={n}` without a `stackup`. */
export function defaultStackup(copper: number, thickness = 1.6): Stackup {
  if (copper !== 2 && copper !== 4 && copper !== 6 && copper !== 8) throw new Error(`copper must be 2, 4, 6 or 8, got ${copper}`)
  return build(copper, { thickness })
}
