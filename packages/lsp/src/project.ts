import { statSync } from 'node:fs'
import { dirname } from 'node:path'
import ts from 'typescript'
import { toInjected, toSource, type ScopeInjection } from '@pcbjs/compile/internal/scope'
import { nameHints, type NameHint } from './names.js'
import { toFile, toUri } from './host.js'

/** The open documents: the text and version of a file, absolute, or undefined when it is not open. */
export interface OpenDocs {
  get(file: string): { text: string; version: number } | undefined
}

/** One insertion a transform made in a file's text, such as the `;const {U1,R1}=sch` of a schematic namespace: the whole code, and the text inserted at `at`. */
export type Injected = Pick<ScopeInjection, 'code' | 'at' | 'text'>
/** What the language service reads instead of a file's text, `read` giving other files as open or on disk; null leaves it as it is. */
export type Inject = (file: string, text: string, read: (file: string) => string | undefined) => Injected | null | undefined

/** Without a tsconfig: what `pcbjs create` writes. */
const DEFAULTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: '@pcbjs/core',
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowJs: false,
  types: [],
}

interface Project {
  service: ts.LanguageService
  files: Set<string>
}

export interface Projects {
  /** the program that holds `file`, with the open text of every document */
  program(file: string): ts.Program | undefined
  /** an offset of the file's own text in the text the service reads, and back */
  toInjected(file: string, offset: number): number
  toSource(file: string, offset: number): number
  service(file: string): ts.LanguageService
  /** the offset of the first type error of `file` within `[start, end]` of its own text, null when none */
  typeError(file: string, start: number, end: number): number | null
  /** the ref style hints of a file, in the service's offsets, computed once per program */
  names(file: string): NameHint[]
  dispose(): void
}

export function projects(docs: OpenDocs, inject?: Inject): Projects {
  const byConfig = new Map<string, Project>()
  const injected = new Map<string, { src: string; out: Injected | null }>()
  const raw = (f: string) => docs.get(f)?.text ?? ts.sys.readFile(f)
  const served = (f: string): Injected | null => {
    const src = raw(f)
    if (src === undefined || !inject || !/\.[cm]?tsx?$/.test(f) || f.endsWith('.d.ts')) return null
    const hit = injected.get(f)
    if (hit?.src === src) return hit.out
    let out: Injected | null = null
    try {
      out = inject(f, src, raw) ?? null
    } catch {}
    injected.set(f, { src, out })
    return out
  }
  const textOf = (f: string) => served(f)?.code ?? raw(f)
  const stamp = (f: string) => {
    try {
      return String(statSync(f).mtimeMs)
    } catch {
      return '0'
    }
  }

  const make = (config: string | undefined, dir: string): Project => {
    let options = DEFAULTS,
      names: string[] = []
    if (config) {
      const read = ts.readConfigFile(config, ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, dirname(config))
      options = { ...parsed.options, noEmit: true }
      names = parsed.fileNames
    }
    const files = new Set(names)
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [...files],
      getScriptVersion: f => {
        const d = docs.get(f)
        return d ? `open:${d.version}` : stamp(f)
      },
      getScriptSnapshot: f => {
        const text = textOf(f)
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
      },
      getCurrentDirectory: () => dir,
      getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
      fileExists: f => !!docs.get(f) || ts.sys.fileExists(f),
      readFile: f => textOf(f),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    }
    return { service: ts.createLanguageService(host, ts.createDocumentRegistry()), files }
  }

  const projectOf = (file: string): Project => {
    const config = ts.findConfigFile(dirname(file), ts.sys.fileExists)
    const key = config ?? `dir:${dirname(file)}`
    let p = byConfig.get(key)
    if (!p) byConfig.set(key, (p = make(config, config ? dirname(config) : dirname(file))))
    p.files.add(file)
    return p
  }

  const program = (file: string) => {
    try {
      return projectOf(file).service.getProgram()
    } catch {
      return undefined
    }
  }
  const named = new WeakMap<ts.Program, Map<string, NameHint[]>>()
  return {
    toInjected: (file, o) => toInjected(served(file), o),
    toSource: (file, o) => toSource(served(file), o),
    program,
    service: file => projectOf(file).service,
    typeError: (file, start, end) =>
      projectOf(file)
        .service.getSemanticDiagnostics(file)
        .map(x => (x.category === ts.DiagnosticCategory.Error && x.start !== undefined ? toSource(served(file), x.start) : -1))
        .find(at => at >= start && at <= end) ?? null,
    names: file => {
      const p = program(file)
      if (!p) return []
      let byFile = named.get(p)
      if (!byFile) named.set(p, (byFile = new Map()))
      let hints = byFile.get(file)
      if (!hints) byFile.set(file, (hints = nameHints(p, file)))
      return hints
    },
    dispose: () => {
      for (const p of byConfig.values()) p.service.dispose()
      byConfig.clear()
    },
  }
}

/** The documents of a session's store, versioned by the store's count of changes. */
export interface StoreDocs {
  get(file: string): { text: string; seq: number } | undefined
}

/** The one program of a session, over the text its store holds: every connection whose own text is the store's reads it. */
export function sessionProjects(store: StoreDocs, inject?: Inject): Projects {
  return projects(
    {
      get: f => {
        const d = store.get(f)
        return d && { text: d.text, version: d.seq }
      },
    },
    inject,
  )
}

/** A connection's documents by URI, as it sent them. */
export type OwnDocs = ReadonlyMap<string, { text: string; version: number }>

/** The program a connection reads: the session's while every text it holds is the store's, else its own over its text then the store's, dropped once the texts agree again. */
export function connectionProjects(own: OwnDocs, store: StoreDocs, shared: Projects, inject?: Inject): { current(): Projects; dispose(): void } {
  let overlay: Projects | null = null
  const diverged = () => {
    for (const [uri, d] of own) if (store.get(toFile(uri) ?? '')?.text !== d.text) return true
    return false
  }
  const dispose = () => {
    overlay?.dispose()
    overlay = null
  }
  return {
    current() {
      if (!diverged()) {
        dispose()
        return shared
      }
      // its own text first, so its positions match what it sent; store versions are negative so they never collide
      return (overlay ??= projects(
        {
          get: f => {
            const mine = own.get(toUri(f))
            if (mine) return mine
            const d = store.get(f)
            return d && { text: d.text, version: -d.seq }
          },
        },
        inject,
      ))
    },
    dispose,
  }
}
