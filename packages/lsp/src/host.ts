// What the language server reads from the session and what it tells the session the editor did: the two sides of its host.

import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SiteData } from '@pcbjs/core/site-data'
import type { AssistContext, PreviewParams, Range } from '@pcbjs/core/protocol'
import type { Inject } from './project.js'
import type { EditorSelection } from './selection.js'

/** One compiled board, or one target of it, with the project root its paths are relative to. */
export interface BoardRef {
  root: string
  site: SiteData
}

/** An editor assist with the project whose board supplied its coordinates. */
export interface ProjectAssist extends AssistContext {
  project: string
}

/** What the session holds that the server reads: the compiled boards and what it knows of the files. */
export interface BoardSource {
  /** every board the session holds now, each target of each, of every loaded project or of the one at `root` */
  boards(root?: string): BoardRef[]
  /** the page a preview should show now, sent after the handshake */
  preview?(): PreviewParams | null
  /** the spans a draft preview skipped, per file */
  skipped?(): { file: string; ranges: Range[] }[]
  /** the edits that freeze the auto placement of the file's parts in `text`, offsets into it, and the 1-based lines of their elements; null when it has none */
  placements?(file: string, text: string): { lines: number[]; edits: { start: number; end: number; newText: string }[] } | null
  /** files written on disk under an editor's unsaved text, which the compile keeps shadowed until the editor saves */
  shadowed?(): { file: string; message: string }[]
}

/** What the server tells the session the editor did. */
export interface EditorEvents {
  /** the editor focused a file, absolute */
  focus?(file: string): void
  /** the editor cursor, 1-based */
  cursor?(file: string, line: number, col: number): void
  /** what every editor selection names, per board built from the file: the members, the primary cursor's the anchor, and the points and reference it marks */
  select?(file: string, boards: EditorSelection[]): void
  /** the cursor waits for a chain call's argument or an `at`, one context per board; none when it left the spot */
  assist?(file: string, contexts: ProjectAssist[]): void
  /** the completion item in focus in a route end slot, one per board it is on; null when the list went */
  endFocus?(file: string, focus: { project: string; board: string; handle: string }[] | null): void
  /** a number in grid units is hovered: light the grid in every preview of the board */
  grid?(project: string, board: string, grid: string): void
  /** the editor closed a file */
  close?(file: string): void
}

/** What a language server is started with besides its connection and documents. */
export interface Host {
  /** the pcbjs version, for the handshake */
  version: string
  source: BoardSource
  events?: EditorEvents
  /** what the type checker reads instead of a file's text, such as the names a schematic namespace brings into scope */
  inject?: Inject
  /** ms with no change before a change's diagnostics go out, the session's quiet period, so typing never waits for the type checker; 0 when absent */
  quiet?: number
}

/** A file URI from a path and back, as editors write them. */
export const toUri = (file: string) => pathToFileURL(file).href
export function toFile(uri: string): string | undefined {
  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}
