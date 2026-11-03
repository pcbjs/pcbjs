// LSP over the boards the session compiled; it never compiles, the session calls refresh(root) once a compile of that project minted a snapshot.
// This module keeps the connection, the documents and one handler per method; the capabilities are pure modules over DocModel and BoardFacts.

import { readFileSync } from 'node:fs'
import type { MessageReader, MessageWriter } from 'vscode-jsonrpc'
import { createConnection as createCommonConnection } from 'vscode-languageserver/lib/common/server.js'
import { createProtocolConnection, type CompletionList, type InitializeParams, type TextDocumentEdit, type TextEdit, type WorkspaceEdit } from 'vscode-languageserver/node.js'
import type { DocRole, DocumentStore, Holder } from './documents.js'
import { docOf, type DocModel } from './doc.js'
import { toSite } from '@pcbjs/core/internal/textdoc'
import { segmentsFor } from './segments.js'
import { METHODS, type FocusParams, type Position, type PreviewParams, type Range, type Segment, type SegmentsParams, type ServerHello } from '@pcbjs/core/protocol'
import { negotiate } from './protocol.js'
import { connectionProjects, type Projects } from './project.js'
import { padSource, targetAt, type Target } from './target.js'
import { boardFacts, segmentContext, type FileFacts } from './facts.js'
import { toFile, toUri, type BoardSource, type EditorEvents, type Host } from './host.js'
import { assistContexts, assistSpot, type AssistSpot } from './assist.js'
import { endFocus, endItems } from './completions.js'
import { codeScope } from './scope.js'
import { encodeTokens, TOKEN_TYPES } from './units.js'
import { hover } from './hover.js'
import { padAccessor, padSignature } from './signature.js'
import { inlayHints } from './inlay.js'
import { codeLenses } from './lenses.js'
import { editorSelection, selectParams, type SelectRange } from './selection.js'
import { diagnostics } from './diagnostics.js'
import { extractAction, freezeAction } from './actions.js'
import { definitions, highlights } from './navigation.js'

export interface LanguageServer {
  /** true once the client completed `initialize` */
  readonly initialized: boolean
  /** what the handshake agreed, null before it */
  readonly hello: ServerHello | null
  /** the client said it speaks the pcbjs messages */
  readonly pcbjsClient: boolean
  /** send `pcbjs/select` with these ranges, the first the primary, `focus` for an Open; false when the client cannot take it */
  select(ranges: SelectRange[], reveal: boolean, focus?: boolean): boolean
  /** send `pcbjs/preview` */
  preview(p: PreviewParams): boolean
  /** where the code connects a pad, for a click on it in a viewer */
  padSource(board: string, ref: string, num: string): SelectRange | undefined
  /** the boards of a project root changed, of every one without: publish the findings again and ask the client to refresh lenses and hints */
  refresh(root?: string): void
  /** this connection in the document store */
  readonly holder: Holder
  /** `workspace/applyEdit` to the client; false when it cannot take one or refused it */
  applyEdit(edit: WorkspaceEdit): Promise<boolean>
  /** the offset of the first type error of `file` within `[start, end]` while the service reads `text`; null when none, undefined when it reads another text */
  typeError(file: string, text: string, start: number, end: number): number | null | undefined
  dispose(): void
}

let servers = 0

/** Start a server on a reader and writer, such as those of messageChannel(), syncing its documents into `store` as `role` allows; `shared` is the session's program over the store. */
export function startLanguageServer(
  transport: { reader: MessageReader; writer: MessageWriter },
  host: Host,
  store: DocumentStore,
  shared: Projects,
  role: DocRole = 'editor',
  name?: string,
): LanguageServer {
  const holder: Holder = { id: `lsp${++servers}`, role, ...(name ? { name } : {}) }
  const source: BoardSource = host.source
  const events: EditorEvents = host.events ?? {}
  let disposed = false
  let shutdown = false
  const watchDog = {
    initialize: () => undefined,
    get shutdownReceived() {
      return shutdown
    },
    set shutdownReceived(v: boolean) {
      shutdown = v
    },
    // never process.exit: the dev server outlives its editors
    exit: () => dispose(),
  }
  // the connection's own logger is its remote console, which would report a send that failed on a closed channel through that channel, forever
  const quiet = { error: () => {}, warn: () => {}, info: () => {}, log: () => {} }
  const connection = createCommonConnection(() => createProtocolConnection(transport.reader, transport.writer, quiet), watchDog)

  const docs = new Map<string, { text: string; version: number }>()
  let hello: ServerHello | null = null
  let pcbjsClient = false
  let initialized = false
  let caps: InitializeParams['capabilities'] = {}
  let published = new Set<string>()
  let lastFocus: string | undefined
  let assistFile: string | undefined
  /** The program over this connection's text: the session's while its text is the store's, else its own. */
  const programs = connectionProjects(docs, store, shared, host.inject)
  const code = () => programs.current()

  // one note per file an editor holds, so an agent learns why its text does not compile
  const refused = new Set<string>()
  const sync = (uri: string, text: string, version: number) => {
    const f = toFile(uri)
    if (!f || role === 'reader' || store.sync(f, text, version, holder) || refused.has(f)) return
    refused.add(f)
    const by = store.holderOf(f)
    void connection
      .sendNotification('window/logMessage', {
        type: 2,
        message: `pcbjs: ${f} is open in an editor${by?.name ? `, ${by.name}` : ''}; this connection's text stays its own and the session compiles the editor's`,
      })
      .catch(() => undefined)
  }
  const release = (uri: string) => {
    const f = toFile(uri)
    if (f) store.release(f, holder)
  }
  connection.onDidOpenTextDocument(p => {
    docs.set(p.textDocument.uri, { text: p.textDocument.text, version: p.textDocument.version })
    sync(p.textDocument.uri, p.textDocument.text, p.textDocument.version)
  })
  connection.onDidChangeTextDocument(p => {
    const last = p.contentChanges[p.contentChanges.length - 1]
    if (!last || ('range' in last && last.range)) return
    docs.set(p.textDocument.uri, { text: last.text, version: p.textDocument.version })
    sync(p.textDocument.uri, last.text, p.textDocument.version)
    typedAt = performance.now()
    clearTimeout(publishing)
    if (host.quiet) publishing = setTimeout(publish, host.quiet)
    else publish()
    ends.edited(toFile(p.textDocument.uri))
  })
  connection.onDidSaveTextDocument(p => release(p.textDocument.uri))
  connection.onDidCloseTextDocument(p => {
    docs.delete(p.textDocument.uri)
    release(p.textDocument.uri)
    const f = toFile(p.textDocument.uri)
    if (f) {
      if (assistFile === f) {
        events.assist?.(f, [])
        assistFile = undefined
      }
      refused.delete(f)
      events.close?.(f)
    }
    code()
  })

  connection.onInitialize(params => {
    caps = params.capabilities ?? {}
    hello = negotiate((params.initializationOptions as { pcbjs?: unknown } | undefined)?.pcbjs, host.version)
    pcbjsClient = hello !== null
    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
        hoverProvider: true,
        signatureHelpProvider: { triggerCharacters: ['[', "'", '"'] },
        completionProvider: { triggerCharacters: ['(', ','], resolveProvider: true },
        definitionProvider: true,
        documentHighlightProvider: true,
        codeLensProvider: { resolveProvider: false },
        codeActionProvider: { codeActionKinds: ['refactor.extract', 'refactor.rewrite'] },
        inlayHintProvider: true,
        // a client that draws pcbjs/tokens itself keeps its own semantic tokens, as VS Code does TypeScript's
        ...(hello?.capabilities.includes('tokens') ? {} : { semanticTokensProvider: { legend: { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [] }, full: true } }),
        ...(hello ? { experimental: { pcbjs: hello } } : {}),
      },
      serverInfo: { name: 'pcbjs', version: host.version },
    }
  })
  connection.onInitialized(() => {
    initialized = true
    publish()
    const p = source.preview?.()
    if (p) sendPreview(p)
  })

  /** The model of a document this connection has open. */
  const docAt = (uri: string): DocModel | undefined => {
    const d = docs.get(uri)
    const f = d && toFile(uri)
    return f ? docOf(f, d.text) : undefined
  }
  /** The facts of a file on the boards the session holds now, computed once per set of boards. */
  const facts = (file: string): FileFacts => boardFacts(source.boards()).forFile(file)
  /** What the innermost token at a position names on the boards, by its declaration and type. */
  const targetOf = (f: FileFacts, doc: DocModel, p: Position): Target | undefined => {
    try {
      const program = code().program(f.file)
      const t = program && targetAt(program, f.file, code().toInjected(f.file, doc.offset(p)), f.all)
      return t && { ...t, start: code().toSource(f.file, t.start), end: code().toSource(f.file, t.end) }
    } catch {
      return undefined
    }
  }
  /** The parts and instances the code at a route's spot can name, so a written handle is an expression in scope there. */
  const scopeAt = (file: string, spot: AssistSpot, offset: number) => {
    if (!spot.ends && !spot.route) return undefined
    try {
      const program = code().program(file)
      return program && codeScope(program, file, code().toInjected(file, offset))
    } catch {
      return undefined
    }
  }

  connection.onDocumentHighlight(p => {
    const file = toFile(p.textDocument.uri)
    return file ? highlights(facts(file), p.position) : []
  })
  connection.onDefinition(p => {
    const file = toFile(p.textDocument.uri)
    return file ? definitions(facts(file), docAt(p.textDocument.uri), p.position) : []
  })
  connection.onSignatureHelp(p => {
    const file = toFile(p.textDocument.uri)
    const doc = docAt(p.textDocument.uri)
    if (!file || !doc || !padAccessor(doc.sf(), doc.offset(p.position))) return null
    try {
      const program = code().program(file)
      return program ? padSignature(program, file, code().toInjected(file, doc.offset(p.position)), facts(file).all) : null
    } catch {
      return null
    }
  })
  connection.onHover(p => {
    const file = toFile(p.textDocument.uri)
    if (!file) return null
    const f = facts(file)
    const doc = docAt(p.textDocument.uri)
    const r = hover({ file, doc, position: p.position, facts: f, target: doc && targetOf(f, doc, p.position) })
    if (r.grid) events.grid?.(r.grid.project, r.grid.board, r.grid.grid)
    return r.hover
  })
  connection.onCodeAction(p => {
    const doc = docAt(p.textDocument.uri)
    if (!doc) return []
    const uri = p.textDocument.uri
    return [...freezeAction(uri, doc, p.range, source.placements?.(doc.file, doc.text)), ...extractAction(uri, doc, facts(doc.file), code(), p.range)]
  })
  connection.onCodeLens(p => {
    const file = toFile(p.textDocument.uri)
    return file ? codeLenses(facts(file)) : []
  })
  connection.onRequest('textDocument/inlayHint', (p: { textDocument: { uri: string }; range: Range }) => {
    const doc = docAt(p.textDocument.uri)
    return doc ? inlayHints(doc, facts(doc.file), p.range) : []
  })

  // a route end slot lists the ends the views annotate, with the same labels, the first end's net first
  connection.onCompletion((p): CompletionList | null => {
    const doc = docAt(p.textDocument.uri)
    if (!doc) return null
    const file = doc.file
    const offset = doc.offset(p.position)
    const spot = assistSpot(doc.sf(), offset)
    if (!spot?.ends) return null
    return { isIncomplete: false, items: endItems(doc, assistContexts(spot, doc, facts(file).all, scopeAt(file, spot, offset))) }
  })
  // the item the editor resolves is the one in focus: the views light it as a hover until the cursor leaves the slot or the list is gone
  const ends = endFocus((file, focus) => events.endFocus?.(file, focus))
  connection.onCompletionResolve(item => (ends.resolved(item), item))

  /** `pcbjs/tokens`: the numbers, units and layers inside the coordinate strings, for a client that colours them itself. */
  connection.onRequest(METHODS.tokens, (p: { textDocument: { uri: string }; range?: Range }) => {
    const doc = docAt(p.textDocument.uri)
    if (!doc) return { tokens: [] }
    const from = p.range ? doc.offset(p.range.start) : 0
    const to = p.range ? doc.offset(p.range.end) : doc.text.length
    return {
      tokens: doc
        .units()
        .tokens.filter(t => t.end >= from && t.start <= to)
        .map(t => ({ range: doc.range(t), type: t.type })),
    }
  })
  connection.onRequest('textDocument/semanticTokens/full', (p: { textDocument: { uri: string } }) => {
    const doc = docAt(p.textDocument.uri)
    return { data: doc ? encodeTokens(doc.pos, doc.units().tokens) : [] }
  })

  connection.onNotification(METHODS.focus, (p: FocusParams) => {
    const file = p?.textDocument?.uri ? toFile(p.textDocument.uri) : undefined
    if (!file) return
    if (assistFile && assistFile !== file) events.assist?.(assistFile, [])
    assistFile = file
    if (file !== lastFocus) {
      lastFocus = file
      events.focus?.(file)
    }
    if (!p.position) return
    const caret = toSite(p.position)
    events.cursor?.(file, caret.line, caret.col)
    const doc = docAt(p.textDocument.uri)
    if (doc && events.assist) {
      const offset = doc.offset(p.position)
      const spot = assistSpot(doc.sf(), offset)
      events.assist(file, spot ? assistContexts(spot, doc, facts(file).all, scopeAt(file, spot, offset)) : [])
      ends.moved(file, !!spot?.ends)
    }
    if (!doc || !events.select) return
    const ranges = Array.isArray(p.selections) && p.selections.length ? p.selections : [{ start: p.position, end: p.position }]
    const select = () => {
      const f = facts(file)
      events.select?.(
        file,
        editorSelection(f, ranges, at => targetOf(f, doc, at), doc),
      )
    }
    // while typing, the type checker behind the highlight waits for the quiet period, so it never holds up the keystroke tier
    clearTimeout(selecting)
    if (host.quiet && performance.now() - typedAt < host.quiet) selecting = setTimeout(() => docs.get(p.textDocument.uri)?.text === doc.text && select(), host.quiet)
    else select()
  })
  let selecting: NodeJS.Timeout | undefined

  // answered in order after every message before it, so the session's queries see the documents a connection synced first
  connection.onRequest(METHODS.flush, () => null)

  connection.onRequest(METHODS.segments, (p: SegmentsParams): Segment[] => {
    const doc = p?.textDocument?.uri ? docAt(p.textDocument.uri) : undefined
    if (!doc || !hello) return []
    return segmentsFor(doc, segmentContext(facts(doc.file), doc), p)
  })

  /** The ref style hints of a design file, in its own offsets. */
  const names = (doc: DocModel) => {
    const c = code()
    return c.names(doc.file).map(h => ({ start: c.toSource(doc.file, h.start), end: c.toSource(doc.file, h.end), message: h.message }))
  }
  let publishing: NodeJS.Timeout | undefined
  // when an editor last changed a document's text
  let typedAt = -Infinity
  function publish(): void {
    clearTimeout(publishing)
    if (!initialized || disposed) return
    const open = new Map<string, DocModel>()
    for (const uri of docs.keys()) {
      const doc = docAt(uri)
      if (doc) open.set(uri, doc)
    }
    const byFile = diagnostics({
      docs: open,
      markers: boardFacts(source.boards()).markers(),
      names,
      skipped: source.skipped?.() ?? [],
      shadowed: source.shadowed?.() ?? [],
    })
    for (const uri of published) if (!byFile.has(uri)) void connection.sendDiagnostics({ uri, diagnostics: [] }).catch(() => undefined)
    for (const [uri, diagnostics] of byFile) void connection.sendDiagnostics({ uri, diagnostics }).catch(() => undefined)
    published = new Set(byFile.keys())
  }

  function sendPreview(p: PreviewParams): boolean {
    if (!initialized || !pcbjsClient || disposed) return false
    void connection.sendNotification(METHODS.preview, p).catch(() => undefined)
    return true
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearTimeout(publishing)
    clearTimeout(selecting)
    if (assistFile) events.assist?.(assistFile, [])
    ends.dispose()
    store.releaseAll(holder)
    programs.dispose()
    try {
      connection.dispose()
    } catch {}
  }

  connection.listen()

  return {
    get initialized() {
      return initialized && !disposed
    },
    get hello() {
      return hello
    },
    get pcbjsClient() {
      return pcbjsClient
    },
    select(ranges, reveal, focus) {
      if (!initialized || !pcbjsClient || disposed || !ranges.length) return false
      void connection.sendNotification(METHODS.select, selectParams(ranges, reveal, focus)).catch(() => undefined)
      return true
    },
    preview: sendPreview,
    typeError(file, text, start, end) {
      if (disposed || (docs.get(toUri(file))?.text ?? store.get(file)?.text) !== text) return undefined
      try {
        return code().typeError(file, start, end)
      } catch {
        return undefined
      }
    },
    padSource(board, ref, num) {
      const b = source.boards().find(x => x.site.name === board) ?? source.boards().find(x => x.site.footprints.some(fp => fp.ref === ref))
      const s = b && padSource(f => code().service(f), b, ref, num)
      if (!s) return undefined
      const text = docs.get(toUri(s.file))?.text ?? readText(s.file)
      if (text === undefined) return undefined
      const doc = docOf(s.file, text)
      return { file: s.file, ...doc.siteOf({ start: code().toSource(s.file, s.start), end: code().toSource(s.file, s.end) }) }
    },
    refresh() {
      if (!initialized || disposed) return
      publish()
      if (caps.workspace?.codeLens?.refreshSupport) void connection.sendRequest('workspace/codeLens/refresh').catch(() => undefined)
      if (caps.workspace?.inlayHint?.refreshSupport) void connection.sendRequest('workspace/inlayHint/refresh').catch(() => undefined)
    },
    holder,
    async applyEdit(edit) {
      if (!initialized || disposed || !caps.workspace?.applyEdit) return false
      try {
        return !!(await connection.workspace.applyEdit(caps.workspace.workspaceEdit?.documentChanges ? edit : unversioned(edit))).applied
      } catch {
        return false
      }
    },
    dispose,
  }
}

/** The text edits of a workspace edit as plain changes, for a client that takes no document changes. */
function unversioned(edit: WorkspaceEdit): WorkspaceEdit {
  if (!edit.documentChanges?.every(c => 'textDocument' in c)) return edit
  const changes: NonNullable<WorkspaceEdit['changes']> = { ...edit.changes }
  for (const c of edit.documentChanges as TextDocumentEdit[]) changes[c.textDocument.uri] = [...(changes[c.textDocument.uri] ?? []), ...(c.edits as TextEdit[])]
  return { changes }
}

const readText = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}
