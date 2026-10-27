// Resolution order: base, global defaults, preset, props; the preset reaches <board> as props so a default never overrides it.
import { h } from '@pcbjs/core/jsx-runtime'
import { cloneData, deepFreeze, mergeRules } from '@pcbjs/core/rules'
import { mergeAutoroute } from '@pcbjs/core/board-spec'
import { mergeClasses } from '@pcbjs/core/netclass'
import { paletteName, type BoundPCB, type PresetBoardProps, type PresetInput, type PresetSpec } from '@pcbjs/core/preset'
import type { Finish, NetClass, PcbNode, Rules, Stackup } from '@pcbjs/core'

// the preset types and the brand check live in @pcbjs/core, which variants() needs
export { isBoundPCB, paletteName, type BoundPCB, type PresetBoardProps, type PresetInput, type PresetSpec } from '@pcbjs/core/preset'

function recolor(s: Stackup, mask?: string, silk?: string, finish?: Finish): Stackup {
  if (mask === undefined && silk === undefined && finish === undefined) return s
  const out: Stackup = { ...s, layers: s.layers.map(l => {
    if (mask !== undefined && l.type === 'mask') return { ...l, color: mask }
    if (silk !== undefined && l.type === 'silk') return { ...l, color: silk }
    return l
  }) }
  if (mask !== undefined) out.maskColor = mask
  if (silk !== undefined) out.silkColor = silk
  if (finish !== undefined) out.finish = finish
  return out
}

/** A <PCB> component bound to a fab preset: `color`, `silk`, `finish` and `rules` apply over the preset. */
export function bindPCB(preset: PresetInput): BoundPCB {
  const colors = { ...(preset.colors ?? {}) }, silkColors = { ...(preset.silkColors ?? { White: '#ececec' }) }
  const fab = preset.fab ?? preset.name?.split(' ').slice(0, -1).join(' ') ?? ''
  const spec: PresetSpec = deepFreeze({
    name: preset.name ?? fab,
    fab,
    stackup: structuredClone(preset.stackup),
    rules: { ...preset.rules },
    colors,
    silkColors,
    finishes: [...(preset.finishes ?? (preset.stackup.finish ? [preset.stackup.finish] : []))],
    ...(preset.sourcing ? { sourcing: [...preset.sourcing] } : {}),
    ...(preset.autoroute ? { autoroute: cloneData(preset.autoroute) } : {}),
    ...(preset.classes ? { classes: cloneData(preset.classes) } : {}),
    ...(preset.cpl ? { cpl: { ...preset.cpl } } : {}),
    ...(preset.fabNotes ? { fabNotes: [...preset.fabNotes] } : {}),
  }) as PresetSpec
  const Board = function (props: PresetBoardProps): PcbNode {
    const { children, color, silk, finish, stackup, rules, sourcing, autoroute, classes, cpl, fabNotes, ...rest } = props
    const tags = sourcing ?? spec.sourcing
    const mask = color === undefined || color === null ? undefined : paletteName(colors, String(color))
    const legend = silk === undefined || silk === null ? undefined : paletteName(silkColors, String(silk))
    const base = stackup ?? (spec.stackup as Stackup)
    return h('board', { ...rest, stackup: recolor(base, mask, legend, finish), rules: mergeRules(spec.rules as Rules, rules), ...(tags ? { sourcing: [...tags] } : {}),
      ...(cpl || spec.cpl ? { cpl: { ...(spec.cpl ?? {}), ...(cpl ?? {}) } } : {}),
      // the preset's notes first; a value that is no list goes on as it is, for the board's check to name
      ...(fabNotes !== undefined && fabNotes !== null && !Array.isArray(fabNotes) ? { fabNotes } : spec.fabNotes || fabNotes ? { fabNotes: [...(spec.fabNotes ?? []), ...(fabNotes ?? [])] } : {}),
      ...(spec.autoroute || autoroute ? { autoroute: mergeAutoroute({}, spec.autoroute, autoroute) } : {}),
      ...(spec.classes || classes ? { classes: spec.classes && classes && typeof classes === 'object' ? mergeClasses(spec.classes as Record<string, NetClass>, classes) : classes ?? cloneData(spec.classes) } : {}) }, children as any)
  } as BoundPCB
  Object.defineProperty(Board, 'preset', { value: spec, enumerable: true })
  Object.defineProperty(Board, 'name', { value: spec.name.replace(/\W+/g, '') || 'PCB' })
  return Board
}

