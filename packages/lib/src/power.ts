import { h } from '@pcbjs/core/jsx-runtime'
import { makeFootprint, r4, type GeneratorOptions, type LibFootprint, type PinsOf } from './footprint.js'
import { memoised, mmArg, optsArg, show } from './gen.js'
import { kicad3d, outline } from './models.js'

/** CR2032 holder, Keystone 3034 as KiCad BatteryHolder_Keystone_3034_1x20mm; route nothing on F.Cu under the cell but the - contact. */
export const CR2032Holder = makeFootprint<'+' | '-'>({
  id: 'pcbjs:BatteryHolder_Keystone_3034_1x20mm', name: 'CR2032Holder', value: 'Keystone 3034', prefix: 'BT',
  pads: [
    { num: '1', name: '+', x: -10.985, y: 0, w: 1.27, h: 5.08, shape: 'rect' },
    { num: '2', name: '-', x: 0, y: 0, w: 17.8, h: 17.8, shape: 'circle' },
    { num: '3', name: '+', x: 10.985, y: 0, w: 1.27, h: 5.08, shape: 'rect' },
  ],
  pins: ['+', '-'],
  body: { cx: 0, cy: 0.69, w: 21.26, h: 16.16 }, height: 4.2,
  model: kicad3d('Battery.3dshapes/BatteryHolder_Keystone_3034_1x20mm.step', outline(21.26, 16.16, 4.2)),
  courtyard: [{ cx: 0, cy: 0, w: 23.74, h: 21.0 }],
  pin1: false,
  silk: [h('text', { layer: 'F.SilkS', at: [-10.985, -3.6], size: 1.2 }, '+'), h('text', { layer: 'F.SilkS', at: [10.985, -3.6], size: 1.2 }, '+')],
  extra: [h('circle', { layer: 'Dwgs.User', r: 10, width: 0.1 }), h('circle', { layer: 'F.Fab', r: 10, width: 0.1 })],
})

export interface BatteryPadsOptions<N extends string = string> extends GeneratorOptions<N> {
  /** pad centre to pad centre, default 2.54 */
  pitch?: number
  /** copper diameter, default 2.0 */
  dia?: number
  /** drill, default 1.0; 0 makes SMD pads of dia by 2 dia for soldered tabs */
  drill?: number
}

/** Two pads for battery leads or tabs, "+" left and "-" right, out of the BOM since the fab places no battery. */
export function BatteryPads<const N extends string = never>(opts: BatteryPadsOptions<N> = {}): LibFootprint<PinsOf<'+' | '-', N>> {
  optsArg('BatteryPads', opts, ['pitch', 'dia', 'drill'], 'the options')
  const { pitch = 2.54, dia = 2.0, drill = 1.0, ...gen } = opts
  mmArg('BatteryPads', 'pitch', pitch)
  mmArg('BatteryPads', 'dia', dia)
  if (!(typeof drill === 'number' && drill >= 0 && Number.isFinite(drill))) throw new TypeError(`BatteryPads: drill must be a number of mm, 0 for SMD pads, got ${show(drill)}`)
  if (!(pitch > dia + 0.2)) throw new RangeError(`BatteryPads: a ${pitch} mm pitch leaves no gap between ${dia} mm pads`)
  if (drill && dia - drill < 0.4) throw new RangeError(`BatteryPads: a ${dia} mm pad around a ${drill} mm drill leaves less than a 0.2 mm ring`)
  return memoised('BatteryPads', [pitch, dia, drill, gen], () => {
    const smd = !drill
    const ph = smd ? 2 * dia : dia
    const pad = (num: string, name: string, x: number, first: boolean) => smd
      ? { num, name, x, y: 0, w: dia, h: ph, shape: first ? 'rect' as const : 'roundrect' as const }
      : { num, name, x, y: 0, w: dia, h: dia, shape: first ? 'rect' as const : 'circle' as const, drill }
    return makeFootprint({
      id: `pcbjs:Battery_Pads_P${pitch}mm${smd ? '_SMD' : ''}`, name: 'BatteryPads', value: 'Battery', prefix: 'BT',
      pads: [pad('1', '+', -pitch / 2, true), pad('2', '-', pitch / 2, false)], pins: ['+', '-'],
      body: { cx: 0, cy: 0, w: r4(pitch + dia), h: ph }, height: 0, model: { kind: 'none' },
      bom: false, pos: false, silk: [h('text', { layer: 'F.SilkS', at: [r4(-pitch / 2), r4(-ph / 2 - 0.9)], size: 0.8 }, '+')], pin1: false,
    }, gen as GeneratorOptions)
  }) as any
}
