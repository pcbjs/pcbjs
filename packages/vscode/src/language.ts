import * as vscode from 'vscode'
import { CloseAction, ErrorAction, LanguageClient } from 'vscode-languageclient/node'
import type { HostedClient } from './host'
import { PcbjsSession, initializationOptions, transports, type EditorPort } from './lsp-client'
import { MARKDOWN } from './hover'
import { draftHint } from './drafts'

export interface LanguageLink {
  readonly client: LanguageClient
  readonly session: PcbjsSession
  /** the server answered the handshake */
  running: boolean
  dispose(): Promise<void>
}

/** Undefined when the server does not answer `initialize` in time. */
export async function startLanguage(
  conn: HostedClient,
  folders: string[],
  version: string,
  output: vscode.OutputChannel,
  port: EditorPort,
  timeoutMs = 10000,
): Promise<LanguageLink | undefined> {
  const patterns = folders.map(f => `${f.replace(/\\/g, '/')}/**/*`)
  const client = new LanguageClient('pcbjs', 'pcbjs', async () => ({ ...transports(conn), detached: true }), {
    documentSelector: patterns.flatMap(pattern => ['typescriptreact', 'typescript'].map(language => ({ scheme: 'file', language, pattern }))),
    initializationOptions: initializationOptions(version),
    markdown: { ...MARKDOWN },
    outputChannel: output,
    middleware: {
      handleDiagnostics: (uri, diags, next) =>
        next(
          uri,
          diags.map(d => draftHint(d, vscode.DiagnosticSeverity.Hint, vscode.DiagnosticTag.Unnecessary)),
        ),
    },
    // the extension starts a new client on the next connection
    errorHandler: { error: () => ({ action: ErrorAction.Continue }), closed: () => ({ action: CloseAction.DoNotRestart, handled: true }) },
  })
  const session = new PcbjsSession(client, port)
  const link: LanguageLink = {
    client,
    session,
    running: false,
    async dispose() {
      link.running = false
      session.dispose()
      try {
        await client.stop(1000)
      } catch {}
    },
  }
  conn.onClose(() => void link.dispose())
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>(ok => (timer = setTimeout(() => ok('timeout'), timeoutMs)))
  try {
    const r = await Promise.race([client.start().then(() => 'ok' as const), timeout])
    if (r === 'timeout') throw new Error('no answer to initialize')
  } catch (err) {
    output.appendLine(`[lsp] the dev server has no language server: ${(err as Error).message}`)
    void link.dispose()
    return undefined
  } finally {
    clearTimeout(timer)
  }
  link.running = true
  const hello = (client.initializeResult?.capabilities?.experimental as any)?.pcbjs
  output.appendLine(
    `[lsp] connected, protocol ${hello?.protocol ?? 'none'}, kinds ${hello?.kinds?.join(', ') ?? 'none'}${hello?.capabilities?.length ? `, ${hello.capabilities.join(', ')}` : ''}`,
  )
  return link
}
