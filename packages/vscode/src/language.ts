import * as vscode from 'vscode'
import { CloseAction, ErrorAction, LanguageClient } from 'vscode-languageclient/node'
import { PcbjsSession, initializationOptions, ownedMiddleware, transports, type DocPeer, type EditorPort, type Holders } from './lsp-client'
import type { Lsp, SessionLink } from './link'
import { MARKDOWN } from './hover'
import { draftHint } from './drafts'

export interface LanguageLink extends Lsp {
  readonly client: LanguageClient
}

/** Undefined when the server does not answer `initialize` in time; `owns` says which files this session serves the editor, one session per file, `holders` which client holds each. The link holds it in `lsp` while it runs. */
export async function startLanguage(
  conn: SessionLink,
  folders: string[],
  version: string,
  output: vscode.OutputChannel,
  port: EditorPort,
  owns: (file: string) => boolean,
  holders: Holders,
  timeoutMs = 10000,
): Promise<LanguageLink | undefined> {
  const patterns = folders.map(f => `${f.replace(/\\/g, '/')}/**/*`)
  const peer: DocPeer = {
    alive: () => conn.open && conn.lsp === link,
    notify: (method, params) => void client.sendNotification(method, params).catch(() => undefined),
  }
  const owned = ownedMiddleware(
    uri => {
      const u = vscode.Uri.parse(uri)
      return u.scheme === 'file' && owns(u.fsPath)
    },
    { holders, peer },
  )
  const client = new LanguageClient('pcbjs', 'pcbjs', async () => ({ ...transports(conn), detached: true }), {
    documentSelector: patterns.flatMap(pattern => ['typescriptreact', 'typescript'].map(language => ({ scheme: 'file', language, pattern }))),
    initializationOptions: initializationOptions(version),
    markdown: { ...MARKDOWN },
    outputChannel: output,
    middleware: {
      ...owned,
      provideSignatureHelp: (doc, position, context, token, next) =>
        owned.provideSignatureHelp(doc, position, context, token, async () => {
          const version = doc.version
          const prepared = session.takeSignature(doc.uri.toString(), position, version)
          if (!prepared) return next(doc, position, context, token)
          const result = await prepared
          if (token.isCancellationRequested || doc.isClosed || doc.version !== version || !owns(doc.uri.fsPath)) return undefined
          return client.protocol2CodeConverter.asSignatureHelp(result, token)
        }),
      handleDiagnostics: (uri, diags, next) =>
        owned.handleDiagnostics(
          uri,
          diags.map(d => draftHint(d, vscode.DiagnosticSeverity.Hint, vscode.DiagnosticTag.Unnecessary)),
          next,
        ),
    },
    // the extension starts a new client on the next connection
    errorHandler: { error: () => ({ action: ErrorAction.Continue }), closed: () => ({ action: CloseAction.DoNotRestart, handled: true }) },
  })
  const session = new PcbjsSession(client, port)
  const link: LanguageLink = {
    client,
    session,
    peer,
    async dispose() {
      session.dispose()
      try {
        await client.stop(1000)
      } catch {}
    },
  }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>(ok => (timer = setTimeout(() => ok('timeout'), timeoutMs)))
  try {
    const r = await Promise.race([client.start().then(() => 'ok' as const), timeout])
    if (r === 'timeout') throw new Error('no answer to initialize')
  } catch (err) {
    output.appendLine(`[lsp] the session has no language server: ${(err as Error).message}`)
    void link.dispose()
    return undefined
  } finally {
    clearTimeout(timer)
  }
  const hello = (client.initializeResult?.capabilities?.experimental as any)?.pcbjs
  output.appendLine(
    `[lsp] connected, protocol ${hello?.protocol ?? 'none'}, kinds ${hello?.kinds?.join(', ') ?? 'none'}${hello?.capabilities?.length ? `, ${hello.capabilities.join(', ')}` : ''}`,
  )
  return link
}
