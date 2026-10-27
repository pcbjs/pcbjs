import type { UserConfig as ViteUserConfig } from 'vite'
import type { RepoLink } from './site-data.js'
import type { FontSpec } from './types.js'

/** Where the project source is hosted. A string is the repository URL; ref, dir and kind are then found from git and the host. */
export type RepoOption = string | { url: string; ref?: string; dir?: string; kind?: RepoLink['kind'] }

export interface UserConfig {
  /** board entries relative to this config, globs allowed; entries on the command line win for that run */
  entries?: string[]
  /** static site output; default ".pcbjs/dist" */
  outDir?: string
  /** loose fab files; default ".pcbjs/fab" */
  fabDir?: string
  /** the site's URL base, default "/"; a relative one such as "./" builds a client-rendered site only */
  base?: string
  /** extra Vite options merged into the site's Vite config */
  vite?: ViteUserConfig
  /** the repository the built site links source ranges to; leave out for no links */
  repo?: RepoOption
  /** how the viewer follows a click on an item to its source */
  editor?: EditorOptions
  /** KiCad libraries for kicadFootprint() of @pcbjs/kicad and pcbjs import, see kicad.md */
  kicad?: KicadOptions
  /** outline fonts for `<text font>` by name, files relative to this config; a board's `fonts` win */
  fonts?: Record<string, string | FontSpec>
}

export interface KicadOptions {
  /** `.pretty` folders, or folders of them, searched before KICAD_FOOTPRINTS and the installed library */
  footprints?: string[]
  /** the folder ${KICAD10_3DMODEL_DIR} and its older names stand for, default the installed KiCad's 3dmodels */
  models?: string
}

export interface EditorOptions {
  /** 'click' (default): a click opens the source, shift+click the definition; 'meta-click': cmd or ctrl+click opens it */
  follow?: 'click' | 'meta-click'
}

export function defineConfig(c: UserConfig): UserConfig {
  return c
}
