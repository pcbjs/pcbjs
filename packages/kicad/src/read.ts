import { h } from '@pcbjs/core/jsx-runtime'
import type { FootprintMeta } from '@pcbjs/core/schematic'
import type { FootprintProps, ModelSpec, PcbNode } from '@pcbjs/core/types'
import { footprintSpecs, padPins, readKicadMod, type ElementSpec, type KFootprint } from './footprint.js'
import { libraryOf, loadFootprint, modelSpec, prefixOf, renamePins, specNodes, type KicadPinNames } from './library.js'

/** A footprint read from KiCad: `defineFootprint(def.render, def.meta)` makes the factory. */
export interface FootprintDefinition {
  /** renders the <footprint> with every pad, graphic, text and keepout */
  render: (props: FootprintProps) => PcbNode
  /** pins in pad order, renamed by pinNames, the NC pads, the prefix and the id */
  meta: FootprintMeta<string> & { pins: readonly string[]; nc: readonly string[]; id: string; name: string }
  /** the <footprint> props it sets: id, value, model, bom, pos, description and netTie */
  props: Record<string, unknown>
  /** the children as element specs, in pcbjs's frame */
  elements: ElementSpec[]
  kicad: KFootprint
}

/** Read a `.kicad_mod`, its text or a path, version 20240108 or newer and most older ones, into a footprint definition. */
export function readFootprint(source: string, o: { pinNames?: KicadPinNames; prefix?: string; model?: ModelSpec | false } = {}): FootprintDefinition {
  const fp = source.trimStart().startsWith('(') ? readKicadMod(source) : loadFootprint(source)
  const id = `${fp.lib ?? libraryOf(fp.file ?? '') ?? 'kicad'}:${fp.name}`
  const { names, pins, nc } = renamePins(fp.name, padPins(fp), o.pinNames)
  const elements = footprintSpecs(fp)
  const kids = specNodes(elements, names)
  const model = o.model === false ? undefined : o.model ?? modelSpec(fp)
  const props: Record<string, unknown> = { id, value: fp.name }
  if (model) props.model = model
  if (!fp.attrs.bom) props.bom = false
  if (!fp.attrs.pos) props.pos = false
  if (fp.descr) props.description = fp.descr
  if (fp.netTie) props.netTie = fp.netTie
  const render = (p: FootprintProps): PcbNode => {
    const { children: more, ...rest } = p
    return h('footprint', { ...props, ...rest }, ...kids, more)
  }
  Object.defineProperty(render, 'name', { value: fp.name })
  return { render, meta: { pins, nc, prefix: o.prefix ?? prefixOf(fp.lib, fp.name), id, name: fp.name, ...(fp.netTie ? { netTie: fp.netTie } : {}) }, props, elements, kicad: fp }
}
