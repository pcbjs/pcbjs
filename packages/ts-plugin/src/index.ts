import type * as TS from 'typescript'
import { moduleExports, scopeInject, ScopeError, type ResolveModule, type ScopeInjection } from '@pcbjs/compile/scope'
import { DROP, inside, into, intoEnd, intoSpan, lineStarts, out, outResult, outSpan, type Inj } from './map'

interface Entry {
  key: string
  version: string
  deps: [string, string][]
  inj: ScopeInjection | null
  /** the schematic module as the file writes it, such as `./board.sch` */
  spec?: string
  error?: ScopeError
  /** the module's value exports, read on the first completion */
  exports?: string[]
  snap?: TS.IScriptSnapshot
  source: string
  view?: TS.SourceFile
}

const CONFIGS = ['pcb.config', 'pcbjs.config'].flatMap(n => ['ts', 'mts', 'js', 'mjs'].map(x => `${n}.${x}`))
const WRAPPED = Symbol.for('pcbjs.ts-plugin')
const CANNOT_FIND = new Set([2304, 2552])
const SCOPE_ERROR = 99001

const AT_POS = ['getCompletionEntrySymbol', 'getQuickInfoAtPosition',
  'getTypeDefinitionAtPosition', 'getImplementationAtPosition', 'getDocumentHighlights', 'getRenameInfo', 'getSignatureHelpItems',
  'getSmartSelectionRange', 'getBraceMatchingAtPosition', 'getIndentationAtPosition', 'getFormattingEditsAfterKeystroke',
  'isValidBraceCompletionAtPosition', 'getJsxClosingTagAtPosition', 'getLinkedEditingRangeAtPosition', 'getSpanOfEnclosingComment',
  'getDocCommentTemplateAtPosition', 'prepareCallHierarchy', 'provideCallHierarchyIncomingCalls', 'provideCallHierarchyOutgoingCalls',
  'getBreakpointStatementAtPosition'] as const
const AT_RANGE = ['getNameOrDottedNameSpan', 'getCodeFixesAtPosition', 'getFormattingEditsForRange'] as const
const AT_SPAN = ['provideInlayHints', 'getSemanticClassifications', 'getSyntacticClassifications'] as const
const AT_TEXT_RANGE = ['toggleLineComment', 'toggleMultilineComment', 'commentSelection', 'uncommentSelection'] as const
const ENCODED = ['getEncodedSemanticClassifications', 'getEncodedSyntacticClassifications'] as const
const RESULT_ONLY = ['getOutliningSpans', 'getNavigationBarItems', 'getNavigationTree', 'getFormattingEditsForDocument', 'organizeImports',
  'getEditsForFileRename', 'getCombinedCodeFix', 'getNavigateToItems', 'getFileReferences', 'getTodoComments'] as const
const DIAGNOSTICS = ['getSyntacticDiagnostics', 'getSemanticDiagnostics', 'getSuggestionDiagnostics'] as const

function init({ typescript: ts }: { typescript: typeof TS }) {
  ;(require('typescript') as { __bind?: (t: typeof TS) => void }).__bind?.(ts)

  function create(info: TS.server.PluginCreateInfo): TS.LanguageService {
    const host = info.languageServiceHost as TS.LanguageServiceHost & { [WRAPPED]?: true; getModuleResolutionCache?(): TS.ModuleResolutionCache }
    const ls = info.languageService
    if (host[WRAPPED]) return ls
    host[WRAPPED] = true
    const log = (m: string) => info.project?.projectService?.logger?.info(`[pcbjs] ${m}`)

    const snap0 = host.getScriptSnapshot.bind(host)
    const ver0 = host.getScriptVersion.bind(host)
    const exists = (f: string) => host.fileExists?.(f) ?? ts.sys.fileExists(f)
    const read = (f: string) => {
      const s = snap0(f)
      return s ? s.getText(0, s.getLength()) : host.readFile?.(f) ?? ts.sys.readFile(f)
    }
    const modHost: TS.ModuleResolutionHost = {
      fileExists: exists,
      readFile: f => host.readFile?.(f) ?? ts.sys.readFile(f),
      directoryExists: d => host.directoryExists?.(d) ?? ts.sys.directoryExists(d),
      realpath: host.realpath?.bind(host) ?? ts.sys.realpath,
      getCurrentDirectory: () => host.getCurrentDirectory(),
      getDirectories: d => host.getDirectories?.(d) ?? ts.sys.getDirectories(d),
    }

    const projects = new Map<string, boolean>()
    const inProject = (dir: string): boolean => {
      let hit = projects.get(dir)
      if (hit !== undefined) return hit
      const up = dir.replace(/\/[^/]*$/, '')
      hit = !/\/node_modules(\/|$)/.test(dir) && (CONFIGS.some(c => exists(`${dir}/${c}`)) || (up !== dir && up !== '' && inProject(up)))
      projects.set(dir, hit)
      return hit
    }
    const wanted = (f: string) => f.endsWith('.tsx') && inProject(f.replace(/\/[^/]*$/, ''))

    const resolver = (deps: string[], seen?: (spec: string, from: string) => void): ResolveModule => (s, from) => {
      seen?.(s, from)
      const r = ts.resolveModuleName(s, from, host.getCompilationSettings(), modHost, host.getModuleResolutionCache?.()).resolvedModule
      if (!r || r.isExternalLibraryImport) return null
      const text = read(r.resolvedFileName)
      if (text === undefined) return null
      deps.push(r.resolvedFileName)
      return { file: r.resolvedFileName, source: text }
    }

    const cache = new Map<string, Entry>()
    const fresh = (e: Entry | undefined, version: string) => e && e.version === version && e.deps.every(([d, v]) => ver0(d) === v)

    function entry(file: string): Entry | undefined {
      if (!wanted(file)) return undefined
      const version = ver0(file)
      const old = cache.get(file)
      if (fresh(old, version)) return old
      const source = read(file)
      if (source === undefined) return undefined
      const deps: string[] = []
      let spec: string | undefined
      const resolveModule = resolver(deps, (s, from) => { if (from === file) spec ??= s })
      const e: Entry = { key: '', version, deps: [], inj: null, source }
      try { e.inj = scopeInject(source, resolveModule, file) } catch (err) {
        if (err instanceof ScopeError) e.error = err
        else log(`scope of ${file}: ${(err as Error).message}`)
      }
      e.spec = spec
      e.deps = deps.map(d => [d, ver0(d)])
      e.key = e.deps.length ? `${version}|${e.deps.map(d => d[1]).join('|')}` : version
      if (e.inj) e.snap = ts.ScriptSnapshot.fromString(e.inj.code)
      cache.set(file, e)
      return e
    }
    const injOf = (f: string): Inj => entry(f)?.inj

    host.getScriptVersion = f => entry(f)?.key ?? ver0(f)
    host.getScriptSnapshot = f => entry(f)?.snap ?? snap0(f)

    const result = (v: unknown, file?: string) => {
      if (![...cache.values()].some(e => e.inj)) return v
      const m = outResult(v, file, injOf)
      return m === DROP ? undefined : m
    }
    const insideOf = (d: { fileName: string; textSpan: TS.TextSpan }) => inside(injOf(d.fileName), d.textSpan.start, d.textSpan.length)

    /** Definitions on an injected binding become those of the module's export. */
    const viaExport = <T extends TS.DefinitionInfo>(defs: readonly T[] | undefined) =>
      defs?.flatMap(d => (insideOf(d) ? (ls.getDefinitionAtPosition(d.fileName, d.textSpan.start) ?? []).filter(x => !insideOf(x)) as T[] : [d]))

    /** Every use of a scoped name: the module's export and its uses, and the uses of each file that binds it. */
    function scopedUses<T extends { fileName: string; textSpan: TS.TextSpan }>(first: readonly T[], at: (f: string, p: number) => readonly T[] | undefined): T[] | undefined {
      const hit = first.find(insideOf)
      if (!hit) return undefined
      const all = [...first]
      for (const d of viaExport(ls.getDefinitionAtPosition(hit.fileName, hit.textSpan.start)) ?? []) {
        for (const l of at(d.fileName, d.textSpan.start) ?? []) {
          all.push(l)
          if (insideOf(l) && l !== hit) all.push(...(at(l.fileName, l.textSpan.start) ?? []))
        }
      }
      const seen = new Set<string>()
      return all.filter(l => !insideOf(l) && !seen.has(`${l.fileName}:${l.textSpan.start}`) && !!seen.add(`${l.fileName}:${l.textSpan.start}`))
    }

    function useSite(file: string, e: Entry, name: string): number | undefined {
      const sf = ls.getProgram()?.getSourceFile(file)
      const inj = e.inj
      if (!sf || !inj) return undefined
      let found: number | undefined
      const visit = (n: TS.Node): void => {
        if (found !== undefined) return
        if (ts.isIdentifier(n) && n.text === name && !inside(inj, n.getStart(sf), name.length)) {
          const p = n.parent
          const member = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isJsxAttribute(p) && p.name === n)
          if (!member) found = out(inj, n.getStart(sf))
        }
        ts.forEachChild(n, visit)
      }
      visit(sf)
      return found
    }

    const specAt = (e: Entry) => {
      const i = e.spec === undefined ? -1 : e.source.lastIndexOf(e.spec, e.inj?.at ?? e.source.length)
      return i < 0 ? { start: 0, length: 0 } : { start: i, length: e.spec!.length }
    }

    function view(sf: TS.SourceFile, e: Entry): TS.SourceFile {
      return (e.view ??= Object.create(sf, { text: { value: e.source }, lineMap: { value: lineStarts(e.source) } }))
    }

    function outDiag<D extends TS.Diagnostic | TS.DiagnosticRelatedInformation>(d: D): D | undefined {
      const e = d.file && entry(d.file.fileName)
      if (!e || d.start === undefined || (!e.inj && e.spec === undefined)) return d
      const inj = e.inj
      const len = d.length ?? 0
      let messageText = d.messageText
      let span: TS.TextSpan
      if (inside(inj, d.start, len)) {
        const name = /^[A-Za-z_$][\w$]*/.exec(inj!.code.slice(d.start))?.[0]
        const use = name === undefined ? undefined : useSite(d.file!.fileName, e, name)
        span = use === undefined ? specAt(e) : { start: use, length: name!.length }
        if (name) messageText = `${name} is not exported by ${e.spec}`
      } else {
        span = outSpan(inj, { start: d.start, length: len })!
        if (e.spec !== undefined && CANNOT_FIND.has(d.code)) {
          const name = e.source.slice(span.start, span.start + span.length)
          const flat = ts.flattenDiagnosticMessageText(d.messageText, '\n')
          const hint = /Did you mean .*$/.exec(flat)?.[0]
          messageText = `${name} is not exported by ${e.spec}${hint ? `. ${hint}` : ''}`
        }
      }
      const related = 'relatedInformation' in d && d.relatedInformation ? { relatedInformation: d.relatedInformation.map(outDiag).filter(r => !!r) } : {}
      return { ...d, ...related, file: e.inj ? view(d.file!, e) : d.file, start: span.start, length: span.length, messageText }
    }

    const scopeError = (file: string): TS.Diagnostic[] => {
      const e = entry(file)
      if (!e?.error) return []
      const sf = ls.getProgram()?.getSourceFile(file)
      return [{ category: ts.DiagnosticCategory.Error, code: SCOPE_ERROR, source: 'pcbjs', file: sf && view(sf, e), start: e.error.pos, length: 1, messageText: e.error.message }]
    }

    const p: any = Object.create(null)
    for (const k of Object.keys(ls) as (keyof TS.LanguageService)[]) {
      const f = ls[k]
      p[k] = typeof f === 'function' ? (f as Function).bind(ls) : f
    }
    const fn = ls as any

    for (const k of AT_POS) p[k] = (file: string, pos: number, ...rest: unknown[]) => result(fn[k](file, into(injOf(file), pos), ...rest), file)
    for (const k of AT_RANGE) p[k] = (file: string, start: number, end: number, ...rest: unknown[]) => {
      const inj = injOf(file)
      return result(fn[k](file, into(inj, start), intoEnd(inj, end), ...rest), file)
    }
    for (const k of AT_SPAN) p[k] = (file: string, span: TS.TextSpan, ...rest: unknown[]) => result(fn[k](file, intoSpan(injOf(file), span), ...rest), file)
    for (const k of AT_TEXT_RANGE) p[k] = (file: string, r: TS.TextRange, ...rest: unknown[]) => {
      const inj = injOf(file)
      return result(fn[k](file, { pos: into(inj, r.pos), end: intoEnd(inj, r.end) }, ...rest), file)
    }
    for (const k of RESULT_ONLY) p[k] = (...a: unknown[]) => result(fn[k](...a), typeof a[0] === 'string' ? a[0] : undefined)
    for (const k of ENCODED) p[k] = (file: string, span: TS.TextSpan, ...rest: unknown[]) => {
      const inj = injOf(file)
      const c: TS.Classifications = fn[k](file, intoSpan(inj, span), ...rest)
      if (!inj) return c
      const spans: number[] = []
      for (let i = 0; i < c.spans.length; i += 3) {
        const s = outSpan(inj, { start: c.spans[i], length: c.spans[i + 1] })
        if (s) spans.push(s.start, s.length, c.spans[i + 2])
      }
      return { ...c, spans }
    }
    for (const k of DIAGNOSTICS) p[k] = (file: string) => {
      const ds = (fn[k](file) as TS.Diagnostic[]).map(outDiag).filter(d => !!d)
      return k === 'getSemanticDiagnostics' ? [...scopeError(file), ...ds] : ds
    }

    const posOrRange = (inj: Inj, r: number | TS.TextRange) => (typeof r === 'number' ? into(inj, r) : { pos: into(inj, r.pos), end: intoEnd(inj, r.end) })
    p.getApplicableRefactors = (file: string, r: number | TS.TextRange, ...rest: unknown[]) => result(fn.getApplicableRefactors(file, posOrRange(injOf(file), r), ...rest), file)
    p.getMoveToRefactoringFileSuggestions = (file: string, r: number | TS.TextRange, ...rest: unknown[]) => result(fn.getMoveToRefactoringFileSuggestions(file, posOrRange(injOf(file), r), ...rest), file)
    p.getEditsForRefactor = (file: string, fmt: unknown, r: number | TS.TextRange, ...rest: unknown[]) => result(fn.getEditsForRefactor(file, fmt, posOrRange(injOf(file), r), ...rest), file)

    const exportsOf = (file: string, e: Entry) => {
      if (e.exports) return e.exports
      const res = resolver([])
      const mod = e.spec === undefined ? null : res(e.spec, file)
      return (e.exports = mod ? [...moduleExports(mod, res)].sort() : [])
    }

    /** Where the schematic module declares an export, for the details of a name the file does not use yet. */
    function exportName(file: string, name: string): { fileName: string; pos: number } | undefined {
      const program = ls.getProgram()
      const sf = program?.getSourceFile(file)
      if (!program || !sf) return undefined
      const checker = program.getTypeChecker()
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamespaceImport(st.importClause.namedBindings)) continue
        const mod = checker.getSymbolAtLocation(st.moduleSpecifier)
        let sym = mod && checker.getExportsOfModule(mod).find(x => x.name === name)
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym)
        const decl = sym?.declarations?.[0]
        const id = decl && ts.getNameOfDeclaration(decl)
        if (id && decl) return { fileName: decl.getSourceFile().fileName, pos: id.getStart() }
      }
      return undefined
    }

    p.getCompletionsAtPosition = (file: string, pos: number, ...rest: unknown[]) => {
      const r = result(fn.getCompletionsAtPosition(file, into(injOf(file), pos), ...rest), file) as TS.CompletionInfo | undefined
      const e = entry(file)
      if (!r || !e?.spec || !r.isGlobalCompletion) return r
      const have = new Set(r.entries.map(x => x.name))
      const more = exportsOf(file, e).filter(n => !have.has(n)).map(name => ({ name, kind: ts.ScriptElementKind.constElement, kindModifiers: '', sortText: '11' }))
      return { ...r, entries: [...r.entries, ...more] }
    }
    p.getCompletionEntryDetails = (file: string, pos: number, name: string, ...rest: unknown[]) => {
      const d = fn.getCompletionEntryDetails(file, into(injOf(file), pos), name, ...rest) as TS.CompletionEntryDetails | undefined
      if (d) return result(d, file)
      const e = entry(file)
      const at = e?.spec !== undefined && exportsOf(file, e).includes(name) ? exportName(file, name) : undefined
      const qi = at && ls.getQuickInfoAtPosition(at.fileName, at.pos)
      return qi && { name, kind: qi.kind, kindModifiers: qi.kindModifiers, displayParts: qi.displayParts ?? [], documentation: qi.documentation, tags: qi.tags }
    }

    p.getDefinitionAtPosition = (file: string, pos: number) => result(viaExport(ls.getDefinitionAtPosition(file, into(injOf(file), pos))), file)
    p.getDefinitionAndBoundSpan = (file: string, pos: number) => {
      const r = ls.getDefinitionAndBoundSpan(file, into(injOf(file), pos))
      return r && result({ ...r, definitions: viaExport(r.definitions) }, file)
    }
    p.getReferencesAtPosition = (file: string, pos: number) => {
      const at = (f: string, q: number) => ls.getReferencesAtPosition(f, q)
      const first = at(file, into(injOf(file), pos))
      return result(first && (scopedUses(first, at) ?? first), file)
    }
    p.findReferences = (file: string, pos: number) => {
      const syms = ls.findReferences(file, into(injOf(file), pos))
      const refs = syms?.flatMap(s => s.references)
      const uses = refs && scopedUses(refs, (f, q) => ls.getReferencesAtPosition(f, q))
      if (!syms || !uses) return result(syms, file)
      const def = viaExport(syms.map(s => s.definition).filter(d => insideOf(d)))?.[0]
      const owner = def && ls.findReferences(def.fileName, def.textSpan.start)?.[0]?.definition
      return result([{ definition: owner ?? syms[0].definition, references: uses }], file)
    }
    p.findRenameLocations = (file: string, pos: number, ...rest: unknown[]) => {
      const at = (f: string, q: number) => fn.findRenameLocations(f, q, ...rest) as TS.RenameLocation[] | undefined
      const first = at(file, into(injOf(file), pos))
      const uses = first && scopedUses(first, at)
      if (!uses) return result(first, file)
      return result(uses.map(({ prefixText, suffixText, ...l }) => (injOf(l.fileName) ? l : { ...l, prefixText, suffixText })), file)
    }

    log(`schematic scope on for ${info.project?.getProjectName?.() ?? 'a project'}`)
    return p as TS.LanguageService
  }

  return { create }
}

export = init
