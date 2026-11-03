// What compiles a project's boards for the dev plugin: the session's worker thread, session/worker-client.ts.
import type { RouteProgress } from '@pcbjs/compile'
import type { Entry } from './config.js'
import type { ModuleLookup } from './boards.js'
import type { BoardOut, Compiled, Library, Preview, Sketch, SketchJob } from './project.js'
import type { View } from '@pcbjs/core/internal/plugin'
import type { FacetName } from '@pcbjs/core/site-facets'
import type { FacetOut, StageStatus } from './facets.js'

export interface CompileJob {
  /** unsaved text reaches the entry: the route files stay as they are */
  draft: boolean
  /** site data with the dev server's URLs; true unless a build asks */
  dev?: boolean
  /** the export formats built, every one when absent */
  formats?: readonly string[]
  progress?: (p: RouteProgress) => void
  /** the views wanted, every one when absent */
  want?: View[]
  facet?: (f: FacetOut) => void
  stage?: (s: StageStatus) => void
}

/** A draft as a compiler needs it: the code it evaluates and where the repair's closers start. */
export interface DraftCode {
  code: string
  limit: number | null
}

/** A board target as the session holds it: what its compile thread sent, the facet hashes it computed there, and the run that keeps its artifacts. */
export interface Held extends BoardOut {
  run: number
  hashes: Partial<Record<FacetName, string>>
}

/** What stays in the compile thread, fetched by `artifact`. */
export type Artifact = 'glb' | 'fab' | 'svg' | 'sch'

export interface Compiler {
  /** rejects with a CancelledError once `cancel` lands */
  compile(entry: Entry, job: CompileJob): Promise<Held[]>
  /** one artifact of a target of a run still kept, the last two runs of each entry */
  artifact<K extends Artifact>(run: number, board: string, target: string | null, kind: K): Promise<Compiled[K]>
  /** the keystroke tier of an edit, stopped by `cancelSketch` alone */
  sketch(entry: Entry, job: Omit<SketchJob, 'signal'>): Promise<Sketch | null>
  layout(entry: Entry, board: string, target: string | null, ref: string): Promise<Library>
  preview(file: string, rel: string): Promise<Preview | null>
  /** the modules of the last compile, for what an edit reaches */
  graph(): ModuleLookup
  /** every file `file` reaches, itself included */
  imported(file: string): Set<string>
  /** files changed on disk: their modules evaluate again */
  changed(files: string[]): void
  /** a file's unsaved text, null when disk rules again */
  draft(file: string, d: DraftCode | null): void
  /** every compile asked for so far stops at its next unit */
  cancel(): void
  /** every keystroke tier asked for so far stops at its next unit */
  cancelSketch(): void
  close(): Promise<void>
}
