// The board module a page imports, `virtual:pcbjs/board`, and what a pcbjs Vite server holds of its project.
import type { Plugin } from 'vite'
import type { LoadStatus, Run, ScopesMsg } from '@pcbjs/core/protocol'
import { boardsPayload, slotsFor, type BoardSlot } from '../project/boards.js'
import type { ResolvedConfig } from '../project/config.js'
import type { BoardOut, Preview } from '../project/project.js'
import type { DraftCodes } from '../project/loader.js'

export const VIRTUAL = 'virtual:pcbjs/board'
export const RESOLVED = '\0' + VIRTUAL

/** What a pcbjs Vite server holds of its project; the session's server holds more, session/plugin.ts. */
export interface PluginState {
  slots: BoardSlot[]
  /** the focused file's own preview when no board imports it, dev only */
  preview?: Preview | null
  /** the editor's unsaved buffers, compiled in place of the files */
  drafts?: DraftCodes | null
  /** a @pcbjs/ui checkout served from its source, from `--ui-src` */
  uiSrc?: string
  closing?: boolean
  idle?: () => Promise<void>
}

export const pluginState = (cfg: Pick<ResolvedConfig, 'entries'>): PluginState => ({ slots: slotsFor(cfg.entries) })

/** The boards of the page as facet sets; `inline` false leaves them to the prerendered pages. */
export function virtualModule(
  state: { slots: BoardSlot<BoardOut>[]; preview?: { compiled: BoardOut } | null },
  workspace: ScopesMsg | null = null,
  status: LoadStatus | null = null,
  run: Run | null = null,
  inline = true,
): string {
  const p = inline ? boardsPayload(state.slots, state.preview?.compiled) : { boards: [], single: state.slots.length === 1, errors: {}, entries: {} }
  return [
    `export const boards = ${JSON.stringify(p.boards)};`,
    `export const single = ${JSON.stringify(p.single)};`,
    `export const errors = ${JSON.stringify(p.errors)};`,
    `export const entries = ${JSON.stringify(p.entries)};`,
    `export const workspace = ${JSON.stringify(workspace)};`,
    `export const run = ${JSON.stringify(inline ? run : null)};`,
    `export const status = ${JSON.stringify(status ?? null)};`,
    '',
  ].join('\n')
}

/** The virtual module of a built site, the boards inlined unless prerendered pages carry them. */
export function sitePlugin(state: PluginState, inline: boolean): Plugin {
  return {
    name: 'pcbjs',
    resolveId: id => (id === VIRTUAL ? RESOLVED : undefined),
    load: id => (id === RESOLVED ? virtualModule(state, null, null, null, inline) : undefined),
  }
}
