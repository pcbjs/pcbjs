import type { UserConfig as ViteUserConfig } from 'vite'
import type { RepoLink } from './site-data.js'

/** Where the project source is hosted: the repository URL, and ref, dir and kind, each found from git and the host when left out. */
export type RepoOption = { url: string; ref?: string; dir?: string; kind?: RepoLink['kind'] }

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
  /** KiCad libraries for kicadFootprint() of @pcbjs/kicad and pcbjs import, see kicad.md */
  kicad?: KicadOptions
  /** compiler plugins, before those of each board's `<PCB plugins>`, see plugins.md */
  plugins?: import('./plugin.js').PcbPlugin[]
  /** the session `pcbjs dev` starts, see session.md */
  session?: SessionOptions
  /** what `pcbjs build --lib` publishes, see library.md */
  lib?: LibConfig
}

export interface LibConfig {
  /** the package's module entries, such as { '.': './index.ts', './buck': './buck.tsx' }; every board of `entries` ships beside them */
  exports: Record<string, string>
}

export interface SessionOptions {
  /** who may edit through the session: 'localhost' (default) the user's socket and loopback, 'all' also LAN clients with the session token, 'none' nobody */
  edit?: 'localhost' | 'all' | 'none'
}

export interface KicadOptions {
  /** `.pretty` folders, or folders of them, searched before KICAD_FOOTPRINTS and the installed library */
  footprints?: string[]
  /** the folder ${KICAD10_3DMODEL_DIR} and its older names stand for, default the installed KiCad's 3dmodels */
  models?: string
}

export function defineConfig(c: UserConfig): UserConfig {
  return c
}
