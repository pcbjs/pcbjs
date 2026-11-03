import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliVersion, installRange } from './doctor.js'
import { parseBoard, shapeBoard, type BoardFlags } from './board-flags.js'
import { recommendExtension, recommendInDevcontainers, repoRoot } from './recommend.js'

const here = dirname(fileURLToPath(import.meta.url))
/** packages/cli/templates, from dist or src alike. */
export const TEMPLATES_DIR = resolve(here, '../templates')
/** templates/examples, copied from examples/ by scripts/sync-examples.mjs. */
export const EXAMPLES_DIR = join(TEMPLATES_DIR, 'examples')

/** The name the templates use for the board, replaced by the new board's name. */
const PLACEHOLDER = /\bHello\b/g
/** Files whose text gets the board name. */
const TEXT = /\.(tsx?|mts|md)$/
/** npm leaves .gitignore out of a published package, so the template keeps it as _gitignore. */
const RENAME: Record<string, string> = { _gitignore: '.gitignore' }

export interface CreateOptions extends BoardFlags {
  dir: string
  /** an example board instead of the template */
  example?: string
  cwd?: string
  log?: (line: string) => void
}

export interface CreateResult {
  dir: string
  name: string
  example?: string
  files: string[]
}

/** Each example board and its one-line description. */
export function examples(): Record<string, string> {
  const index = join(EXAMPLES_DIR, 'index.json')
  return existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) : {}
}

export function listExamples(log: (line: string) => void = line => console.log(line)): void {
  const all = Object.entries(examples())
  const width = Math.max(0, ...all.map(([name]) => name.length))
  for (const [name, description] of all) log(`${name.padEnd(width)}  ${description}`)
}

/** A board name from a directory name: letters, digits, dot, dash and underscore, anything else as a dash. */
export function boardName(dir: string): string {
  return (
    basename(resolve(dir))
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+|-+$/g, '') || 'board'
  )
}

/** An npm package name from a board name: lowercase, no leading dot or underscore. */
function packageName(name: string): string {
  return name.toLowerCase().replace(/^[._]+/, '') || 'board'
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir)
    .filter(f => !['.pcbjs', 'node_modules', '.git'].includes(f))
    .sort()
    .flatMap(f => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p)]
    })
}

function source(opts: CreateOptions): string {
  const flags = [opts.layers, opts.fab, opts.size, opts.outline].some(v => v !== undefined)
  if (opts.example !== undefined) {
    if (flags) throw new Error('--example takes no --layers, --fab, --size or --outline')
    const all = Object.keys(examples())
    if (!all.includes(opts.example)) throw new Error(`unknown example ${JSON.stringify(opts.example)}, available: ${all.join(', ') || 'none'}`)
    return join(EXAMPLES_DIR, opts.example)
  }
  return join(TEMPLATES_DIR, 'board')
}

export function create(opts: CreateOptions): CreateResult {
  const log = opts.log ?? (line => console.log(line))
  const src = source(opts)
  const board = opts.example === undefined ? parseBoard(opts) : undefined
  const target = resolve(opts.cwd ?? process.cwd(), opts.dir)
  if (existsSync(target)) {
    if (!statSync(target).isDirectory()) throw new Error(`${opts.dir} exists and is not a directory`)
    if (readdirSync(target).length) throw new Error(`${opts.dir} is not empty; give a new or empty directory`)
  }
  const name = boardName(target)
  const files: string[] = []
  for (const rel of walk(src)) {
    const out = join(dirname(rel), RENAME[basename(rel)] ?? basename(rel))
    let body: string | Buffer = readFileSync(join(src, rel))
    if (basename(rel) === 'package.json') {
      const pkg = JSON.parse(body.toString('utf8'))
      pkg.name = packageName(name)
      for (const k of Object.keys(pkg.devDependencies ?? {})) if (k.startsWith('@pcbjs/')) pkg.devDependencies[k] = installRange(cliVersion())
      body = JSON.stringify(pkg, null, 2) + '\n'
    } else if (board && TEXT.test(rel)) {
      body = body.toString('utf8').replace(PLACEHOLDER, name)
      if (rel === 'pcb.tsx') body = shapeBoard(body, board)
    }
    mkdirSync(dirname(join(target, out)), { recursive: true })
    writeFileSync(join(target, out), body)
    files.push(out)
  }
  // a clone prompts for the extension; a devcontainer of the project or of the repository around it lists it for Codespaces
  const repo = repoRoot(dirname(target))
  const recommended = [...recommendExtension(target), ...recommendInDevcontainers(target), ...(repo ? recommendInDevcontainers(repo).map(l => `${l} of ${repo}`) : [])]
  files.push(join('.vscode', 'extensions.json'))
  const shown = relative(opts.cwd ?? process.cwd(), target) || '.'
  log(opts.example === undefined ? `pcbjs: created the board ${name} in ${shown} from the board template\n` : `pcbjs: created ${shown} from the ${opts.example} example\n`)
  for (const l of recommended) log(`pcbjs: ${l}`)
  log('Next:')
  if (shown !== '.') log(`  cd ${shown}`)
  log('  npm install')
  log('  npx pcbjs check  # check the board and TypeScript before building')
  log('  npm run dev      # edit pcb.tsx, the viewer updates on every save')
  log('  npm run build    # fab files and the site, with the DRC and ERC summary')
  return { dir: target, name, ...(opts.example === undefined ? {} : { example: opts.example }), files }
}

/** `pcbjs create`: --list-examples prints the examples, else a project in dir. */
export function createCommand(dir: string | undefined, o: Omit<CreateOptions, 'dir'> & { listExamples?: boolean }): void {
  if (o.listExamples) return listExamples()
  if (!dir) throw new Error('create needs a directory, for example pcbjs create my-board')
  const { listExamples: _list, ...opts } = o
  create({ ...opts, dir })
}
