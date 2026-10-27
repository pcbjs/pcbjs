import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliVersion, installRange } from './doctor.js'

const here = dirname(fileURLToPath(import.meta.url))
/** packages/cli/templates, from dist or src alike. */
export const TEMPLATES_DIR = resolve(here, '../templates')

/** The name the templates use for the board, replaced by the new board's name. */
const PLACEHOLDER = /\bHello\b/g
/** Files whose text gets the board name. */
const TEXT = /\.(tsx?|mts|md)$/
/** npm leaves .gitignore out of a published package, so the template keeps it as _gitignore. */
const RENAME: Record<string, string> = { _gitignore: '.gitignore' }

export interface CreateOptions {
  dir: string
  template?: string
  cwd?: string
  log?: (line: string) => void
}

export interface CreateResult { dir: string; name: string; template: string; files: string[] }

export function templates(): string[] {
  return existsSync(TEMPLATES_DIR) ? readdirSync(TEMPLATES_DIR).filter(f => statSync(join(TEMPLATES_DIR, f)).isDirectory()).sort() : []
}

/** A board name from a directory name: letters, digits, dot, dash and underscore, anything else as a dash. */
export function boardName(dir: string): string {
  return basename(resolve(dir)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'board'
}

/** An npm package name from a board name: lowercase, no leading dot or underscore. */
function packageName(name: string): string {
  return name.toLowerCase().replace(/^[._]+/, '') || 'board'
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).sort().flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p)]
  })
}

export function create(opts: CreateOptions): CreateResult {
  const template = opts.template ?? 'board'
  const log = opts.log ?? (line => console.log(line))
  const available = templates()
  if (!available.includes(template)) throw new Error(`unknown template ${JSON.stringify(template)}, available: ${available.join(', ') || 'none'}`)
  const target = resolve(opts.cwd ?? process.cwd(), opts.dir)
  if (existsSync(target)) {
    if (!statSync(target).isDirectory()) throw new Error(`${opts.dir} exists and is not a directory`)
    if (readdirSync(target).length) throw new Error(`${opts.dir} is not empty; give a new or empty directory`)
  }
  const name = boardName(target)
  const src = join(TEMPLATES_DIR, template)
  const files: string[] = []
  for (const rel of walk(src)) {
    const out = join(dirname(rel), RENAME[basename(rel)] ?? basename(rel))
    let body: string | Buffer = readFileSync(join(src, rel))
    if (basename(rel) === 'package.json') {
      const pkg = JSON.parse(body.toString('utf8'))
      pkg.name = packageName(name)
      for (const k of Object.keys(pkg.devDependencies ?? {})) if (k.startsWith('@pcbjs/')) pkg.devDependencies[k] = installRange(cliVersion())
      body = JSON.stringify(pkg, null, 2) + '\n'
    } else if (TEXT.test(rel)) body = body.toString('utf8').replace(PLACEHOLDER, name)
    mkdirSync(dirname(join(target, out)), { recursive: true })
    writeFileSync(join(target, out), body)
    files.push(out)
  }
  const shown = relative(opts.cwd ?? process.cwd(), target) || '.'
  log(`pcbjs: created the board ${name} in ${shown} from the ${template} template\n`)
  log('Next:')
  if (shown !== '.') log(`  cd ${shown}`)
  log('  npm install')
  log('  npm run dev      # edit pcb.tsx, the viewer updates on every save')
  log('  npm run build    # fab files and the site, with the DRC and ERC summary')
  return { dir: target, name, template, files }
}
