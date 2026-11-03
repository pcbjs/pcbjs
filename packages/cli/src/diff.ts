// `pcbjs diff <ref>`: each board of the working tree against the same entry at a git ref, compiled in a worktree under the
// user cache, both in child processes; before, after and the tinted diff as PNGs with diff.json in .pcbjs/diff, docs/diff.md.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Board } from '@pcbjs/core/model'
import type { Finding } from '@pcbjs/core/finding'
import { variantSlug } from '@pcbjs/core/internal/variants'
import { userCacheDir } from '@pcbjs/compile/internal/user-cache'
import { resolveConfig } from './project/config.js'
import { diffItems, findingsDelta } from './render/diff-match.js'
import { DEFAULT_SIZE, THEME_COLORS, type RenderSpec } from './render/spec.js'
import type { Image } from './render/worker-client.js'
import type { FlatInput } from './render/flat.js'

export interface DiffOptions {
  ref: string
  entries?: string[]
  config?: string
  root?: string
  /** default `.pcbjs/diff` */
  outDir?: string
  view?: '2d' | 'sch'
  layers?: string[]
  side?: 'F' | 'B'
}

interface TreeBoard {
  entry: string
  target: string | null
  board: Board
  findings: Finding[]
}

interface Tree {
  boards: TreeBoard[]
  /** a line per entry that failed */
  errors: string[]
}

const CHILD = fileURLToPath(new URL('./diff-child.js', import.meta.url))

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim().split('\n')[0])
  return r.stdout.trim()
}

/** A fresh folder for the worktree, under the user cache, else the temp folder. */
function worktreeDir(): string {
  for (const base of [join(userCacheDir(), 'diff'), tmpdir()])
    try {
      mkdirSync(base, { recursive: true })
      return mkdtempSync(join(base, 'wt-'))
    } catch {
      /* not writable */
    }
  throw new Error('diff: no folder for the worktree')
}

/** The working tree's node_modules from the project up to the repository top, linked into the worktree where it has none. */
function linkModules(top: string, root: string, wt: string): void {
  for (let d = root; ; d = dirname(d)) {
    const at = join(wt, relative(top, d))
    if (existsSync(join(d, 'node_modules')) && existsSync(at) && !existsSync(join(at, 'node_modules')))
      symlinkSync(join(d, 'node_modules'), join(at, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    if (d === top || dirname(d) === d) return
  }
}

function compileTree(root: string, config: string, entries: string[]): Promise<Tree> {
  const out = join(mkdtempSync(join(tmpdir(), 'pcbjs-diff-')), 'tree.json')
  return new Promise(done => {
    const p = spawn(process.execPath, [CHILD, root, out, config, ...entries], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } })
    let err = ''
    p.stderr.on('data', d => (err += d))
    p.on('close', () => {
      let r: Tree & { error?: string }
      try {
        r = JSON.parse(readFileSync(out, 'utf8'))
      } catch {
        r = { boards: [], errors: [], error: err.trim().split('\n').at(-1) || 'the compile exited without a result' }
      }
      rmSync(dirname(out), { recursive: true, force: true })
      done(r.error ? { boards: [], errors: [r.error] } : r)
    })
  })
}

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._+-]+/g, '-').replace(/^-+|-+$/g, '') || 'board'
const shown = (p: string) => {
  const rel = relative(process.cwd(), p)
  return rel && !rel.startsWith('..') ? rel : p
}

async function png(img: Image): Promise<Uint8Array> {
  const { encodePng } = await import('@pcbjs/renderer')
  return encodePng(img.rgba, img.width, img.height, { Software: 'pcbjs' })
}

/** Writes one board's images and diff.json; the line printed for it. */
async function diffBoard(b: TreeBoard, was: TreeBoard | null, o: DiffOptions, dir: string, ref: { name: string; sha: string }): Promise<string> {
  const { rasterSvg } = await import('./render/render.js')
  const { boardView, schematicView, svgOpen, fitFrame, layers2d } = await import('./render/flat.js')
  const { diffView, pixelDiff, sharedBox, DIFF_MARGIN } = await import('./render/diff.js')
  const view = o.view ?? '2d'
  const size = DEFAULT_SIZE
  const theme = 'light'
  const canvas = THEME_COLORS[theme].canvas
  const box = sharedBox([was?.board ?? null, b.board])
  const spec: RenderSpec = { view, theme, size, margin: DIFF_MARGIN, ...(o.layers?.length ? { layers: o.layers } : {}), ...(o.side ? { side: o.side } : {}) }
  const frame = { text: box.join(','), parts: [], items: [], nets: [], findings: [], box }
  const flat = (board: Board): FlatInput => ({ spec, board, frame: view === '2d' ? frame : null, highlight: [], marks: [], theme, size })
  const blank = () => rasterSvg(`${svgOpen(fitFrame(box, DIFF_MARGIN, size), size, canvas)}\n</svg>`)
  const draw = async (board: Board | null): Promise<Image> => {
    if (!board) return blank()
    if (view === '2d') return rasterSvg(boardView(flat(board)))
    const svg = schematicView(flat(board))
    return svg ? rasterSvg(svg) : blank()
  }
  const [before, after] = await Promise.all([draw(was?.board ?? null), draw(b.board)])
  const pixels = pixelDiff(before, after, canvas)
  const items = view === '2d' ? diffItems(was?.board ?? { ...b.board, items: [] }, b.board, o.layers?.length ? layers2d(b.board, o.layers) : undefined) : null
  const image = items ? await rasterSvg(diffView({ before: was?.board ?? null, after: b.board, diff: items, spec, box, size })) : pixels.image
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'before.png'), await png(before))
  writeFileSync(join(dir, 'after.png'), await png(after))
  writeFileSync(join(dir, 'diff.png'), await png(image))
  const count = (c: string) => items?.items.filter(i => i.change === c).length ?? 0
  const counts = { added: count('added'), removed: count('removed'), moved: count('moved') }
  const findings = findingsDelta(was?.findings ?? [], b.findings)
  const by = items ? items.by : 'pixels'
  const notes = [
    ...(was ? [] : [`${b.entry} is not at ${ref.name}: every item is added`]),
    ...(by === 'geometry' ? [`a side mints no item uids, so items are matched by geometry`] : []),
    ...(by === 'pixels' ? ['the schematic is compared by pixels alone'] : []),
    ...(items && !items.items.length && pixels.changed ? [`${pixels.changed} pixels changed outside the copper`] : []),
  ]
  const fr = fitFrame(box, DIFF_MARGIN, size)
  const report = {
    board: b.board.name,
    ...(b.target ? { target: b.target } : {}),
    entry: b.entry,
    ref: ref.name,
    sha: ref.sha,
    view,
    by,
    counts,
    pixels: pixels.changed,
    notes,
    frame: { viewBox: fr.vb, size, mmPerPx: fr.mmPerPx },
    items: items?.items ?? [],
    findings,
  }
  writeFileSync(join(dir, 'diff.json'), JSON.stringify(report, null, 2) + '\n')
  const name = `${b.board.name}${b.target ? ` [${b.target}]` : ''}`
  const what = items ? `+${counts.added} -${counts.removed} ~${counts.moved}` : `${pixels.changed} px`
  return `${name}  ${what}  findings +${findings.new.length} -${findings.fixed.length}  ${shown(dir)}/${notes.length ? `  ${notes.join('; ')}` : ''}`
}

/** Copies the route memos of `from` into the tree at `to`, so unchanged legs come from one cache on both sides. */
export function shareRoutes(from: string, to: string): void {
  const memos = join('.pcbjs', 'cache', 'route')
  if (existsSync(join(from, memos)) && existsSync(to)) cpSync(join(from, memos), join(to, memos), { recursive: true })
}

export async function diff(o: DiffOptions): Promise<number> {
  const cfg = await resolveConfig(o.entries ?? [], 'build', o.config, o.root, () => {})
  const root = realpathSync(cfg.root)
  const outDir = resolve(root, o.outDir ?? join('.pcbjs', 'diff'))
  let top: string, sha: string
  try {
    top = realpathSync(git(root, 'rev-parse', '--show-toplevel'))
  } catch (e) {
    console.error(`pcbjs diff: ${(e as Error).message}`)
    return 1
  }
  try {
    sha = git(root, 'rev-parse', '--verify', '--quiet', `${o.ref}^{commit}`)
  } catch {
    console.error(`pcbjs diff: ${o.ref} is no commit`)
    return 1
  }
  const entries = cfg.entries.map(e => relative(root, realpathSync(e.file)).split('\\').join('/'))
  const config = cfg.configFile ? relative(root, cfg.configFile) : '-'
  const wt = worktreeDir()
  let now: Tree, then: Tree
  try {
    git(top, 'worktree', 'add', '--detach', '--quiet', wt, sha)
    const refRoot = join(wt, relative(top, root))
    linkModules(top, root, wt)
    shareRoutes(root, refRoot)
    const there = entries.filter(e => existsSync(join(refRoot, e)))
    const refConfig = config !== '-' && existsSync(join(refRoot, config)) ? config : '-'
    ;[now, then] = await Promise.all([compileTree(root, config, entries), there.length ? compileTree(refRoot, refConfig, there) : { boards: [], errors: [] }])
  } catch (e) {
    console.error(`pcbjs diff: ${(e as Error).message}`)
    return 1
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: top })
    rmSync(wt, { recursive: true, force: true })
    spawnSync('git', ['worktree', 'prune'], { cwd: top })
  }
  for (const l of now.errors) console.error(`working tree: ${l}`)
  for (const l of then.errors) console.error(`${o.ref}: ${l}`)
  const ref = { name: o.ref, sha }
  let failed = now.errors.length + then.errors.length
  for (const b of now.boards) {
    const was = then.boards.find(x => x.entry === b.entry && x.target === b.target) ?? null
    const slug = b.target ? `~${fileSafe(variantSlug(b.target))}` : ''
    try {
      console.log(await diffBoard(b, was, o, join(outDir, `${fileSafe(b.board.name)}${slug}`), ref))
    } catch (e) {
      console.error(`${b.board.name}  ${(e as Error).message.replace(/^render: /, '')}`)
      failed++
    }
  }
  return failed || !now.boards.length ? 1 : 0
}
