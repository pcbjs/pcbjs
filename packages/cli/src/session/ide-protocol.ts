// What the session offers in its ready and warns of in a hello; the protocol itself is @pcbjs/core/protocol, docs/ide-bridge.md has the frames.
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAJOR, PROTOCOL, compat, type Events, type Hello } from '@pcbjs/core/protocol'

/** What `ready` offers: the events it takes, and `lsp` when @pcbjs/lsp is installed. */
export function serverCapabilities(): string[] {
  return lspInstalled() ? ['bye', 'layout', 'lsp'] : ['bye', 'layout']
}

let lsp: boolean | undefined
/** Looked up on disk, not resolved, so a ready loads nothing of the language server. */
function lspInstalled(): boolean {
  if (lsp !== undefined) return lsp
  for (let d = dirname(fileURLToPath(import.meta.url)); ; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules', '@pcbjs', 'lsp', 'package.json')) || (basename(dirname(d)) === '@pcbjs' && existsSync(join(dirname(d), 'lsp', 'package.json'))))
      return (lsp = true)
    if (dirname(d) === d) return (lsp = false)
  }
}

export const readyProtocol = () => ({ protocol: PROTOCOL, major: MAJOR, capabilities: serverCapabilities() })

/** The warning for a hello that is not one. */
export const NO_HELLO = `[pcbjs] the editor's hello lacks protocol, major and capabilities, this pcbjs needs IDE protocol major ${MAJOR}: run \`pcbjs ide install\` in this project for the matching extension`

/** Null unless the hello speaks another protocol major than this server's. */
export function helloWarning(h: Pick<Hello, 'name' | 'version' | 'protocol' | 'major'>): string | null {
  if (compat(h) !== 'incompatible') return null
  return `[pcbjs] the editor extension ${h.name} ${h.version} speaks IDE protocol major ${h.major}, this pcbjs needs ${MAJOR}: run \`pcbjs ide install\` in this project for the matching extension`
}

/** The editor events a session keeps and sends again to a connection that says hello. */
export const STICKY = ['pcbjs:ide:scopes', 'pcbjs:ide:scope', 'pcbjs:ide:boards'] as const satisfies readonly (keyof Events)[]
