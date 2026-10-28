// cached in .pcbjs/typecheck.json by size and mtime of every file read; schematic names bound as scope.ts in @pcbjs/compile does
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { scopeHost, sourcePosition } from '@pcbjs/compile/scope'

export interface TypeError_ {
  /** file:line:col relative to the project root */
  src: string
  code: number
  /** the head of tsc's message chain, whole */
  message: string
  /** the rest of the chain, outermost first: the last line is the innermost reason, often the useful part of a TS2345 */
  detail?: string[]
}

interface Cache {
  key: string
  files: Record<string, string>
  errors: TypeError_[]
}

const stamp = (f: string): string => {
  try {
    const s = statSync(f)
    return `${s.size}:${s.mtimeMs}`
  } catch {
    return 'missing'
  }
}

/** Type check the entries with the root's tsconfig.json, null without one; errors in project files only. */
export function typecheck(root: string, entries: string[], cacheDir = join(root, '.pcbjs')): { errors: TypeError_[]; cached: boolean; ms: number } | null {
  const t0 = performance.now()
  const config = join(root, 'tsconfig.json')
  if (!existsSync(config)) return null
  const cacheFile = join(cacheDir, 'typecheck.json')
  const key = JSON.stringify([3, ts.version, entries.map(e => resolve(root, e)).sort(), stamp(config)])
  try {
    const c = JSON.parse(readFileSync(cacheFile, 'utf8')) as Cache
    if (c.key === key && Object.entries(c.files).every(([f, s]) => stamp(f) === s)) return { errors: c.errors, cached: true, ms: performance.now() - t0 }
  } catch {
    /* no cache yet */
  }

  const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
  const options: ts.CompilerOptions = { ...(parsed?.options ?? {}), noEmit: true }
  const { host, injections, errors: scopeErrors } = scopeHost(options, root)
  const program = ts.createProgram(
    entries.map(e => resolve(root, e)),
    options,
    host,
  )
  const inProject = (f: string) => f.startsWith(root + '/') && !f.includes('/node_modules/')
  const errors: TypeError_[] = []
  for (const [f, e] of scopeErrors) {
    const { line, character } = ts.getLineAndCharacterOfPosition(ts.createSourceFile(f, ts.sys.readFile(f) ?? '', ts.ScriptTarget.Latest), e.pos)
    errors.push({ src: `${relative(root, f)}:${line + 1}:${character + 1}`, code: 0, message: e.message.replace(/^\S+:\d+: /, '') })
  }
  const diags = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()]
  for (const sf of program.getSourceFiles()) if (inProject(sf.fileName)) diags.push(...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf))
  for (const d of diags) {
    if (d.category !== ts.DiagnosticCategory.Error) continue
    let src = relative(root, config)
    const at = sourcePosition(d, injections)
    if (at) src = `${relative(root, at.file)}:${at.line}:${at.col}`
    // the head of the chain says what is wrong, the rest narrows it down to the innermost reason; nothing is cut
    const [head, ...rest] = ts
      .flattenDiagnosticMessageText(d.messageText, '\n')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
    errors.push({ src, code: d.code, message: head ?? '', ...(rest.length ? { detail: rest } : {}) })
  }
  const files: Record<string, string> = {}
  for (const sf of program.getSourceFiles()) files[sf.fileName] = stamp(sf.fileName)
  try {
    mkdirSync(dirname(cacheFile), { recursive: true })
    writeFileSync(cacheFile, JSON.stringify({ key, files, errors } satisfies Cache))
  } catch {
    /* a read-only project still gets its answer */
  }
  return { errors, cached: false, ms: performance.now() - t0 }
}

/** A type error as a findings line, never cut, then the innermost reason of its chain, or with `verbose` the whole chain. */
export const typeErrorLine = (e: TypeError_, verbose = false): string => {
  const more = verbose ? (e.detail ?? []) : (e.detail ?? []).slice(-1)
  return [`error    typecheck  ${e.src}: ${e.code ? `TS${e.code} ` : ''}${e.message}`, ...more.map(l => `    ${l}`)].join('\n')
}
