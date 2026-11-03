import { existsSync, globSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { loadConfigFromFile } from 'vite'
import type { UserConfig } from '@pcbjs/core/internal/config'
import type { PcbPlugin } from '@pcbjs/core/internal/plugin'
import { setKicadConfig } from '@pcbjs/kicad/internal/library'

export interface Entry {
  /** absolute path of the module */
  file: string
  /** the path relative to the project root, forward slashes */
  rel: string
}

export interface ResolvedConfig {
  root: string
  configFile: string | null
  /** the config file and every file it imports, absolute, for the cache index */
  configFiles: string[]
  /** the design entries in order, from the command line or the config's `entries`, each default-exporting <PCB> */
  entries: Entry[]
  outDir: string
  fabDir: string
  base: string
  vite: UserConfig['vite']
  repo: UserConfig['repo']
  /** read every copper and outline Gerber back and compare it with the board: set by `pcbjs build` and `pcbjs check --fab` */
  fabCheck?: boolean
  /** the date every fab file carries, ISO 8601; absent means SOURCE_DATE_EPOCH, else the time of each compile */
  fabDate?: string
  /** compiler plugins from `plugins`, see plugins.md */
  plugins: PcbPlugin[]
  /** what `pcbjs build --lib` publishes, see library.md */
  lib: UserConfig['lib'] | null
}

/** The config file names, looked up in this order in the project root. */
export const CONFIG_NAMES = ['pcb.config.ts', 'pcb.config.mts', 'pcb.config.js', 'pcb.config.mjs']
/** The config file of a project, the first of CONFIG_NAMES that exists. */
export function findConfig(root: string, exists: (file: string) => boolean = existsSync): string | null {
  for (const c of CONFIG_NAMES) if (exists(resolve(root, c))) return resolve(root, c)
  return null
}

const isGlob = (p: string): boolean => /[*?[\]{}]/.test(p)

/** The files of a config's `entries`, relative to its directory, globs expanded and sorted, no duplicates; a missing path or empty glob throws. */
export function expandEntries(patterns: string[], dir: string, shown: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of patterns) {
    if (typeof p !== 'string' || !p) throw new Error(`entries in ${shown} must be a list of paths, got ${JSON.stringify(p)}`)
    let files: string[]
    if (isGlob(p)) {
      files = globSync(p, { cwd: dir, exclude: (f: string) => f === 'node_modules' || f === '.pcbjs' })
        .map(f => resolve(dir, f))
        .filter(f => statSync(f).isFile())
        .sort()
      if (!files.length) throw new Error(`no file matches the entry pattern ${JSON.stringify(p)} in ${shown}`)
    } else {
      const f = resolve(dir, p)
      if (!existsSync(f)) throw new Error(`entry not found: ${p}, listed in entries in ${shown}`)
      files = [f]
    }
    for (const f of files)
      if (!seen.has(f)) {
        seen.add(f)
        out.push(f)
      }
  }
  return out
}

/** Where the entries of a run come from: the command line, else the config, else nothing, which is an error. */
export interface EntrySource {
  /** absolute entry files */
  files: string[]
  from: 'command line' | 'config'
  /** the one line printed when the command line overrides the config's entries, null otherwise */
  note: string | null
}

/** The entries of a run: the command line's, else the config's `entries`, else an error. */
export function pickEntries(cli: string[], configEntries: unknown, o: { root: string; configFile: string | null; shown: string | null }): EntrySource {
  const listed = configEntries === undefined || configEntries === null ? [] : configEntries
  if (!Array.isArray(listed)) throw new Error(`entries in ${o.shown} must be a list of paths such as ['pcb.tsx'], got ${JSON.stringify(listed)}`)
  const fromConfig = listed.length && o.configFile ? expandEntries(listed, dirname(o.configFile), o.shown!) : []
  if (cli.length) {
    const files = cli.map(e => {
      const f = isAbsolute(e) ? e : resolve(o.root, e)
      if (!existsSync(f)) throw new Error(`entry not found: ${e}`)
      return f
    })
    const same = files.length === fromConfig.length && files.every((f, i) => f === fromConfig[i])
    const note = fromConfig.length && !same ? `pcbjs: using the entries on the command line for this run, not the ${fromConfig.length} in ${o.shown}` : null
    return { files, from: 'command line', note }
  }
  if (fromConfig.length) return { files: fromConfig, from: 'config', note: null }
  const name = o.shown ?? 'pcb.config.ts'
  throw new Error(
    o.configFile
      ? `no entries: add entries: ['pcb.tsx'] to ${name}, or pass the entries on the command line`
      : `no entries: create ${name} with export default defineConfig({ entries: ['pcb.tsx'] }), or pass the entries on the command line`,
  )
}

/** The config file and what it exports, without the entries: for a command that only needs the settings. */
export async function loadUserConfig(
  command: 'serve' | 'build',
  configArg?: string,
  root = process.cwd(),
): Promise<{ root: string; file: string | null; shown: string | null; user: UserConfig; deps: string[] }> {
  root = resolve(root)
  const file = configArg ? resolve(root, configArg) : findConfig(root)
  let user: UserConfig = {}
  let deps: string[] = []
  if (file) {
    if (!existsSync(file)) throw new Error(`config not found: ${configArg}`)
    const loaded = await loadConfigFromFile({ command, mode: command === 'build' ? 'production' : 'development' }, file, root, 'silent')
    user = (loaded?.config ?? {}) as UserConfig
    // esbuild names them relative to the working directory
    deps = (loaded?.dependencies ?? []).map(d => resolve(d))
  }
  // kicadFootprint() in the design reads the project's KiCad library folders from here
  setKicadConfig(file ? dirname(file) : root, user.kicad)
  const shown = file ? (!relative(root, file).startsWith('..') ? relative(root, file) : file) : null
  return { root, file, shown, user, deps }
}

/** The config of the project in the working directory, entries by pickEntries. */
export async function resolveConfig(
  entries: string[],
  command: 'serve' | 'build',
  configArg?: string,
  root = process.cwd(),
  log: (line: string) => void = l => console.log(l),
): Promise<ResolvedConfig> {
  const loaded = await loadUserConfig(command, configArg, root)
  return configFrom(loaded, entries, log)
}

/** A ResolvedConfig from a loaded config and the command line entries. */
export function configFrom(loaded: Awaited<ReturnType<typeof loadUserConfig>>, entries: string[], log: (line: string) => void = l => console.log(l)): ResolvedConfig {
  const { root, file, shown, user } = loaded
  const picked = pickEntries(entries, user.entries, { root, configFile: file, shown: shown ?? 'pcb.config.ts' })
  if (picked.note) log(picked.note)
  return configOf(loaded, picked.files)
}

/** A ResolvedConfig of a loaded config with these entry files, absolute, duplicates dropped. */
export function configOf(loaded: Awaited<ReturnType<typeof loadUserConfig>>, files: string[]): ResolvedConfig {
  const { root, file, user, deps } = loaded
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(root, p))
  const seen = new Set<string>()
  const list: Entry[] = []
  for (const f of files) {
    if (seen.has(f)) continue
    seen.add(f)
    list.push({ file: f, rel: relative(root, f).split('\\').join('/') })
  }
  return {
    root,
    configFile: file,
    configFiles: [...new Set([...(file ? [file] : []), ...(deps ?? [])])],
    entries: list,
    outDir: abs(user.outDir ?? '.pcbjs/dist'),
    fabDir: abs(user.fabDir ?? '.pcbjs/fab'),
    base: user.base ?? '/',
    vite: user.vite,
    repo: user.repo,
    plugins: user.plugins ?? [],
    lib: user.lib ?? null,
  }
}
