import { relative, sep } from 'node:path'
import { MODEL_LABEL, modelSource } from '@pcbjs/core/internal/model-source'
import { validateMesh, type MeshValidation, type MeshIssueCode } from '@pcbjs/step'
import type { Compiled } from './project.js'
import { partMeshes } from './models.js'

const posix = (p: string) => p.split(sep).join('/')

export interface ModelRow {
  board: string
  ref: string
  source: string
  status: 'ok' | 'missing' | 'unread' | 'off' | 'invalid'
  issue?: string
  coverage?: { fit: boolean; mesh: boolean }
  geometry?: MeshValidation
}

type ModelBoard = Pick<Compiled, 'board' | 'site' | 'entry'>

export function modelRows(c: ModelBoard): ModelRow[] {
  return c.site.footprints.map(sf => {
    const s = sf.step
    if (!s) {
      const box = sf.model?.kind === 'box' ? sf.model : null
      if (box?.fetch) return { board: c.board.name, ref: sf.ref, source: `not fetched ${box.fetch}`, status: 'missing' as const, issue: 'the model did not download' }
      if (box?.reason) return { board: c.board.name, ref: sf.ref, source: 'no model', status: 'ok' as const, issue: box.reason }
      const from = modelSource(sf.model, sf.height)
      return { board: c.board.name, ref: sf.ref, source: from === 'generated' ? `generated ${sf.model!.kind}` : MODEL_LABEL[from], status: 'ok' as const }
    }
    const status = !s.mesh ? 'missing' : s.issue?.startsWith('the file did not read') ? 'unread' : s.issue ? 'off' : 'ok'
    const issue = status === 'missing' ? 'the file is missing' : s.issue
    return { board: c.board.name, ref: sf.ref, source: `file ${s.file}`, status, ...(issue ? { issue } : {}) }
  })
}

const MESH_ISSUE: Record<MeshIssueCode, string> = {
  empty: 'empty meshes',
  'array-length': 'inconsistent mesh arrays',
  'nonfinite-position': 'nonfinite vertex positions',
  'nonfinite-normal': 'missing or nonfinite vertex normals',
  'zero-normal': 'zero-length vertex normals',
  'index-range': 'triangles with invalid vertex indices',
  degenerate: 'degenerate triangles',
  winding: 'triangles with winding opposite their normals',
}

/** The same model inventory and geometry checks for the CLI and a settled session snapshot. */
export function modelReport(root: string, compiled: ModelBoard[]): { stdout: string; exitCode: number; models: ModelRow[] } {
  const many = compiled.length > 1
  const lines: string[] = [],
    models: ModelRow[] = []
  const checked = new Map<string, MeshValidation | null>()
  let flagged = 0,
    files = 0,
    total = 0,
    generated = 0,
    missing = 0
  for (const c of compiled) {
    const rows = modelRows(c).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    const entry = posix(relative(root, c.entry.file))
    const mesh = partMeshes(root, c.board, c.site)
    const footprints = new Map(c.site.footprints.map(f => [f.ref, f]))
    lines.push(`${c.board.name}  ${entry}`)
    const w = Math.max(...rows.map(r => r.ref.length), 3),
      ws = Math.max(...rows.map(r => r.source.length), 6)
    for (const r of rows) {
      const fp = footprints.get(r.ref)!
      const hash = fp.step?.mesh ?? fp.mesh
      if (hash && r.status !== 'missing' && r.status !== 'unread') {
        if (!checked.has(hash)) {
          const model = mesh(hash)
          checked.set(hash, model ? validateMesh(model) : null)
        }
        const geometry = checked.get(hash)
        if (geometry) {
          r.geometry = geometry
          if (geometry.issues.some(i => i.code !== 'degenerate')) r.status = 'invalid'
        } else if (r.status === 'ok') {
          r.status = 'unread'
          r.issue = 'the mesh could not be loaded for validation'
        }
      }
      r.coverage = { fit: !!fp.step?.mesh && r.status !== 'unread' && r.status !== 'missing', mesh: !!r.geometry }
      models.push(r)
      total++
      if (r.source.startsWith('file')) files++
      else if (r.source.startsWith('generated')) generated++
      else if (r.source === 'no model') missing++
      lines.push(`  ${r.ref.padEnd(w)}  ${r.source.padEnd(ws)}  ${r.status}${r.issue ? `: ${r.issue}` : ''}`)
      if (r.geometry)
        for (const i of r.geometry.issues)
          lines.push(`  ${' '.repeat(w)}  ${i.code === 'degenerate' ? 'warning' : 'mesh'}: ${i.count} ${MESH_ISSUE[i.code]}${i.mesh >= 0 ? ` (mesh ${i.mesh + 1})` : ''}`)
      if (r.status !== 'ok') {
        flagged++
        const ref = many ? `${r.ref} --entry ${entry}` : r.ref
        lines.push(
          `  ${' '.repeat(w)}  fix: ${r.status === 'invalid' ? 'repair the source mesh, its winding and normals; then inspect top, back and side views' : r.source.startsWith('not fetched') ? 'pcbjs model fetch' : r.status === 'missing' ? `pcbjs model add <file-or-url> --ref ${ref} --write` : r.status === 'unread' ? `pcbjs model add <file-or-url> --ref ${ref} --write --force, a STEP, glTF or WRL file` : `pcbjs model align ${r.ref}${many ? ` --entry ${entry}` : ''}`}`,
        )
      }
    }
  }
  lines.push(`${total} footprints, ${files} with a model file, ${generated} generated, ${missing} with no model, ${flagged} flagged`)
  lines.push(`scope: ${models.filter(r => r.coverage?.fit).length} file-fit checks, ${models.filter(r => r.coverage?.mesh).length} mesh checks`)
  lines.push(stdlibLine(compiled))
  return { stdout: lines.join('\n') + '\n', exitCode: flagged ? 1 : 0, models }
}

/** How the standard library's parts got their bodies, and those still to fetch. */
export function stdlibLine(compiled: Pick<Compiled, 'site'>[]): string {
  let n = 0,
    fetched = 0,
    generated = 0,
    bare = 0,
    waiting = 0,
    outline = 0
  for (const c of compiled)
    for (const sf of c.site.footprints) {
      if (!sf.id.startsWith('pcbjs:')) continue
      n++
      const m = sf.model
      if (sf.step?.mesh) fetched++
      else if (m?.kind === 'box' && m.fetch) waiting++
      else if (m?.kind === 'box') outline++
      else if (modelSource(m, sf.height) === 'generated') generated++
      else bare++
    }
  const parts = [`${fetched} with fetched models`, `${generated} generated`, `${bare} with no body`]
  if (waiting) parts.push(`${waiting} not fetched yet, pcbjs model fetch`)
  if (outline) parts.push(`${outline} with no model`)
  return `standard library: ${n} part${n === 1 ? '' : 's'}, ${parts.join(', ')}`
}
