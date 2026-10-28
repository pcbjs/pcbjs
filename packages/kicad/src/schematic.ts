// The board file carries only the fields KiCad copied onto footprints, so the importer reads MPN and the rest from the schematic.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { atom, child, children, head, isList, parseSExpr, type SList } from './sexpr.js'

export interface KSymbolFields {
  /** every property but Reference and Footprint, by name, as written */
  fields: Record<string, string>
  /** `(dnp yes)`, or a field named DNP with a true value */
  dnp: boolean
  /** `(in_bom no)` makes it false */
  inBom: boolean
  /** `(on_board no)` makes it false */
  onBoard: boolean
  file: string
}

const yes = (l: SList | undefined) => {
  const v = atom(l)
  return v === undefined ? undefined : v === 'yes' || v === 'true'
}
const TRUE_TEXT = /^(1|y|yes|true|dnp|x)$/i

/** The root schematic `<name>.kicad_sch` beside the `.kicad_pcb`, if any; its sheets are read through it. */
export function schematicFiles(boardFile: string): string[] {
  const root = boardFile.replace(/\.kicad_pcb$/, '.kicad_sch')
  return existsSync(root) ? [root] : []
}

/** The fields of every symbol by reference, through every sheet; power symbols and unreadable files are skipped. */
export function readSchematicFields(files: string | string[]): Map<string, KSymbolFields> {
  const out = new Map<string, KSymbolFields>()
  const seen = new Set<string>()
  const queue = (Array.isArray(files) ? files : [files]).map(f => resolve(f))
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    let root: SList
    try {
      root = parseSExpr(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    if (head(root) !== 'kicad_sch') continue
    // KiCad 6 lists the references of every placement at the root, by symbol path
    const legacy = new Map<string, string[]>()
    for (const p of children(child(root, 'symbol_instances'), 'path')) {
      const uuid = (atom(p) ?? '').split('/').pop() ?? ''
      const ref = atom(child(p, 'reference'))
      if (uuid && ref) legacy.set(uuid, [...(legacy.get(uuid) ?? []), ref])
    }
    for (const e of root) {
      if (!isList(e)) continue
      if (e[0] === 'sheet') {
        const props = children(e, 'property')
        const f = props.find(p => /^(Sheetfile|Sheet file)$/.test(atom(p) ?? ''))
        const name = f ? atom(f, 2) : atom(child(e, 'file'))
        if (name) queue.push(resolve(dirname(file), name))
        continue
      }
      if (e[0] !== 'symbol' || !child(e, 'lib_id')) continue
      const fields: Record<string, string> = {}
      let ref = ''
      for (const p of children(e, 'property')) {
        const k = atom(p) ?? '',
          v = atom(p, 2) ?? ''
        if (k === 'Reference') ref = v
        else if (k !== 'Footprint') fields[k] = v
      }
      const refs = new Set<string>()
      for (const proj of children(child(e, 'instances'), 'project'))
        for (const p of children(proj, 'path')) {
          const r = atom(child(p, 'reference'))
          if (r) refs.add(r)
        }
      for (const r of legacy.get(atom(child(e, 'uuid')) ?? '') ?? []) refs.add(r)
      if (!refs.size && ref) refs.add(ref)
      const dnpField = Object.entries(fields).find(([k]) => /^dnp$/i.test(k))
      const dnp = yes(child(e, 'dnp')) === true || (!!dnpField && TRUE_TEXT.test(dnpField[1].trim()))
      if (dnpField) delete fields[dnpField[0]]
      const sym: KSymbolFields = { fields, dnp, inBom: yes(child(e, 'in_bom')) !== false, onBoard: yes(child(e, 'on_board')) !== false, file }
      for (const r of refs) {
        if (r.startsWith('#')) continue
        // the units of one symbol merge, the first unit's value kept
        const prev = out.get(r)
        if (prev) {
          prev.fields = { ...sym.fields, ...prev.fields }
          prev.dnp ||= sym.dnp
          prev.inBom &&= sym.inBom
          continue
        }
        out.set(r, { ...sym, fields: { ...sym.fields } })
      }
    }
  }
  return out
}
