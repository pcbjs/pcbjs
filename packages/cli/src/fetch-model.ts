import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kicadModel } from '@pcbjs/kicad'
import { REMOTE_MODEL, type RemoteModelResolver } from '@pcbjs/compile/models'

/** The tag of KiCad's 3D library the stdlib's models are aligned against. */
export const KICAD_3D_TAG = '10.0.7'
const KICAD_RAW = `https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/${KICAD_3D_TAG}/`
const EASYEDA_MODELS = 'https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/'
const KICAD_LICENCE = 'CC-BY-SA 4.0 with the KiCad library exception, https://www.kicad.org/libraries/license/'

export const fetchedDir = (root: string): string => join(root, '.pcbjs', 'models', 'fetched')

const kicadPath = (source: string) => source.slice('kicad:'.length).replace(/\.wrl$/i, '.step')

/** Where a fetched model is cached in a project. */
export function fetchedPath(root: string, source: string): string {
  const dir = fetchedDir(root)
  if (/^kicad:/i.test(source)) return join(dir, `kicad-${KICAD_3D_TAG}`, ...kicadPath(source).split('/'))
  if (/^lcsc:/i.test(source)) return join(dir, 'lcsc', `${source.slice(5).toUpperCase()}.step`)
  const u = new URL(source)
  return join(dir, u.host, ...u.pathname.split('/').filter(Boolean).map(decodeURIComponent))
}

/** The download URL of a `kicad:` or https source. */
export const sourceUrl = (source: string): string => (/^kicad:/i.test(source) ? KICAD_RAW + kicadPath(source) : source)

/** The licence line of a source, as far as its host says. */
export function licenceOf(source: string): string {
  if (/^kicad:/i.test(source) || /gitlab\.com\/kicad\//.test(source)) return `KiCad 3D library ${KICAD_3D_TAG}, ${KICAD_LICENCE}`
  if (/github(usercontent)?\.com\/espressif\/kicad-libraries/.test(source)) return `Espressif KiCad library, ${KICAD_LICENCE}`
  if (/^lcsc:/i.test(source)) return "EasyEDA library model for the LCSC part, no licence stated: for the 3D view, check the maker's terms before you share the file"
  return 'licence not known: check the source before you share the file'
}

const LICENSES_HEAD =
  "# Model sources\n\nWhere each model file in this folder came from and when it was added. Check the licence of each source before you share or sell a design with the model: manufacturer models usually allow use in designs but not redistribution, and KiCad's packages3D models are CC-BY-SA 4.0 with an exception that lets designs and generated files use them freely.\n\n"

/** Append the source line of a model to <dir>/LICENSES.md, creating the file with its header. */
export function noteSource(dir: string, file: string, source: string, date = new Date().toISOString().slice(0, 10)): string {
  const md = join(dir, 'LICENSES.md')
  const line = `- \`${file}\`: ${source}, added ${date}\n`
  const had = existsSync(md) ? readFileSync(md, 'utf8') : null
  if (had === null) writeFileSync(md, LICENSES_HEAD + line)
  else if (!had.includes(`\`${file}\`: ${source},`)) appendFileSync(md, (had.endsWith('\n') ? '' : '\n') + line)
  return md
}

/** The STEP model of an LCSC part, no login: easyeda.com/api/products/<C-number>/components names it, modules.easyeda.com serves it. */
export async function lcscModel(code: string, fetcher: typeof fetch = fetch): Promise<{ data: Uint8Array; name: string; url: string; note: string }> {
  const c = code.toUpperCase()
  if (!/^C\d+$/.test(c)) throw new Error(`lcsc:${code}: an LCSC part number is C and digits, such as C965555`)
  const api = `https://easyeda.com/api/products/${c}/components`
  const r = await fetcher(api, { headers: { accept: 'application/json' } })
  const j: any = r.ok ? await r.json().catch(() => null) : null
  if (!j?.success || !j.result) throw new Error(`${c}: not in EasyEDA's library (${api}: ${j?.message ?? `HTTP ${r.status}`})`)
  let ds = j.result.packageDetail?.dataStr
  if (typeof ds === 'string') {
    try {
      ds = JSON.parse(ds)
    } catch {
      ds = null
    }
  }
  let model: { uuid: string; title: string } | null = null
  for (const sh of ds?.shape ?? []) {
    if (typeof sh !== 'string' || !sh.startsWith('SVGNODE~')) continue
    try {
      const a = JSON.parse(sh.slice(8)).attrs
      if (a?.c_etype === 'outline3D' && /^[0-9a-f]{32}$/.test(a.uuid)) {
        model = { uuid: a.uuid, title: String(a.title ?? c) }
        break
      }
    } catch {
      /* not a node */
    }
  }
  const pkg = String(j.result.packageDetail?.title ?? '')
  if (!model) throw new Error(`${c}: EasyEDA's footprint ${pkg || 'for it'} has no 3D model`)
  const url = EASYEDA_MODELS + model.uuid
  const m = await fetcher(url)
  if (!m.ok) throw new Error(`${c}: ${url}: HTTP ${m.status}`)
  return {
    data: new Uint8Array(await m.arrayBuffer()),
    name: `${model.title}.step`,
    url,
    note: `LCSC ${c} ${j.result.title ?? ''}, EasyEDA library model ${model.title}`.replace(/\s+/g, ' '),
  }
}

/** Download a source into the project's cache, the file written whole or not at all, and note its licence. */
export async function download(root: string, source: string): Promise<string> {
  const dest = fetchedPath(root, source)
  let data: Uint8Array, from: string
  if (/^lcsc:/i.test(source)) {
    const m = await lcscModel(source.slice(5).trim())
    data = m.data
    from = `${m.note}, ${m.url}`
  } else {
    const url = sourceUrl(source)
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
    data = new Uint8Array(await r.arrayBuffer())
    if (!/ISO-10303-21/.test(new TextDecoder().decode(data.subarray(0, 64)))) throw new Error(`${url}: not a STEP file`)
    from = url
  }
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, dest)
  } finally {
    rmSync(tmp, { force: true })
  }
  const dir = fetchedDir(root)
  noteSource(dir, relative(dir, dest).split(sep).join('/'), `${from}; ${licenceOf(source)}`)
  return dest
}

/** A `kicad:` source from an installed KiCad library, else null. */
function installed(source: string): string | null {
  if (!/^kicad:/i.test(source)) return null
  const file = kicadModel(`\${KICAD9_3DMODEL_DIR}/${kicadPath(source)}`)
  return !file.startsWith('${') && existsSync(file) ? file : null
}

const CHILD = fileURLToPath(new URL('./fetch-model-child.js', import.meta.url))
// sources that did not download in this process, and whether the network is down, so a compile tries each once
const STATE = Symbol.for('pcbjs.cli.fetchModel')
const envOffline = () => (process.env.PCBJS_OFFLINE ? 'PCBJS_OFFLINE is set' : null)
const state = (): { failed: Map<string, string>; offline: string | null; told: Set<string> } =>
  ((globalThis as any)[STATE] ??= { failed: new Map(), offline: envOffline(), told: new Set() })

/** Forget the failures of this process, for `model fetch`. */
export function retryFetches(): void {
  const s = state()
  s.failed.clear()
  s.told.clear()
  s.offline = envOffline()
}

/** The resolver the compile calls for each fetched model: the installed KiCad library, the cache, or a download in a child process. */
export function remoteResolver(root: string): RemoteModelResolver {
  return source => {
    const local = installed(source)
    if (local) return local
    const dest = fetchedPath(root, source)
    if (existsSync(dest)) return dest
    const s = state()
    if (s.failed.has(source)) return null
    let why = s.offline
    if (!why) {
      const r = spawnSync(process.execPath, [CHILD, root, source], { encoding: 'utf8', timeout: 60_000 })
      if (existsSync(dest)) return dest
      why = (r.stderr || r.error?.message || 'the download timed out').trim().split('\n')[0]
      if (r.status === 2 || r.error) s.offline = why
    }
    s.failed.set(source, why)
    return null
  }
}

/** One line for the parts of a board whose models did not download, once per process for the same parts. */
export function fetchNotice(board: string, waiting: { ref: string; source: string }[]): string | null {
  if (!waiting.length) return null
  const s = state(),
    refs = waiting.map(w => w.ref)
  const key = `${board}:${refs.join(',')}`
  if (s.told.has(key)) return null
  s.told.add(key)
  const why = [...new Set(waiting.map(w => s.failed.get(w.source)).filter(Boolean))].join('; ') || 'not fetched'
  const list = refs.length > 6 ? `${refs.slice(0, 6).join(', ')} and ${refs.length - 6} more` : refs.join(', ')
  return `pcbjs: ${board}: ${list} ${refs.length === 1 ? 'shows a dashed outline' : 'show dashed outlines'}, the model did not download (${why}); run pcbjs model fetch`
}

/** Let the next compile of this project resolve and fetch its models; the compile is synchronous, so each sets its own root. */
export function installModelFetch(root: string): void {
  ;(globalThis as any)[REMOTE_MODEL] = remoteResolver(root)
}
