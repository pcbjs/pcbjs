// The mapping of site/brand/icons/README.md; no vscode import, so the build script and the tests use it too.

import * as path from 'node:path'

export const ICONS = ['entry', 'config', 'schematic', 'footprint', 'fab', 'preview'] as const
export type Icon = (typeof ICONS)[number]

export const CONFIG_NAMES = ['pcb', 'pcbjs'].flatMap(b => ['ts', 'mts', 'js', 'mjs'].map(x => `${b}.config.${x}`))

const SCHEMATIC = /\.sch\.tsx?$/

/** A key with one parent folder, such as `lib/tsx`, matches only inside a folder of that name. */
export interface Associations {
  fileNames: Record<string, Icon>
  fileExtensions: Record<string, Icon>
  folderNames: Record<string, Icon>
}

/** What the projects add to the fixed patterns, as absolute paths. */
export interface Found {
  entries: string[]
  footprints: string[]
  fabDirs: string[]
  zips: string[]
}

/** Later keys win a tie of equal specificity, so `lib/` comes before the entry and schematic suffixes. */
export function fixedAssociations(): Associations {
  const fileNames: Record<string, Icon> = { 'pcb.tsx': 'entry' }
  for (const n of CONFIG_NAMES) fileNames[n] = 'config'
  return {
    fileNames,
    fileExtensions: { 'lib/ts': 'footprint', 'lib/tsx': 'footprint', 'pcb.tsx': 'entry', 'sch.ts': 'schematic', 'sch.tsx': 'schematic' },
    folderNames: { '.pcbjs/fab': 'fab' },
  }
}

const parentKey = (file: string) => `${path.basename(path.dirname(file))}/${path.basename(file)}`

/** Each found file by its folder and name; config and schematic win over entry, entry over footprint. */
export function foundAssociations(found: Found): Associations {
  const fileNames: Record<string, Icon> = {}
  const folderNames: Record<string, Icon> = {}
  const fixed = (f: string) => CONFIG_NAMES.includes(path.basename(f)) || SCHEMATIC.test(f)
  for (const f of found.footprints) if (!fixed(f)) fileNames[parentKey(f)] = 'footprint'
  for (const f of found.entries) if (!fixed(f)) fileNames[parentKey(f)] = 'entry'
  for (const d of found.fabDirs) folderNames[parentKey(d)] = 'fab'
  for (const z of found.zips) fileNames[parentKey(z)] = 'fab'
  return { fileNames, fileExtensions: {}, folderNames }
}

export function mergeAssociations(...all: Associations[]): Associations {
  const out: Associations = { fileNames: {}, fileExtensions: {}, folderNames: {} }
  for (const a of all) {
    Object.assign(out.fileNames, a.fileNames)
    Object.assign(out.fileExtensions, a.fileExtensions)
    Object.assign(out.folderNames, a.folderNames)
  }
  return out
}

/** The string literals in `entries: [...]` of a config's source; a glob stays a glob. */
export function configEntries(src: string): string[] {
  const list = /\bentries\s*:\s*\[([^\]]*)\]/.exec(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))
  if (!list) return []
  return [...list[1].matchAll(/(['"`])([^'"`]+)\1/g)].map(m => m[2])
}

export const isGlob = (p: string) => /[*?{}[\]]/.test(p)

export interface ThemeLayer {
  fileNames?: Record<string, string>
  fileExtensions?: Record<string, string>
  folderNames?: Record<string, string>
  folderNamesExpanded?: Record<string, string>
}

export interface IconTheme extends ThemeLayer {
  iconDefinitions: Record<string, Record<string, unknown>>
  light?: ThemeLayer
}

const def = (icon: Icon, light: boolean) => `_pcbjs_${icon}${light ? '_light' : ''}`

/** Seti plus the pcbjs file icons, `icons` relative to the theme file; no folder icon, as one drops VS Code's `align-icons-and-twisties` and shifts every file row. */
export function iconTheme(seti: IconTheme, assoc: Associations, icons = '../icons/tree'): IconTheme {
  const defs = { ...seti.iconDefinitions }
  for (const icon of ICONS) {
    defs[def(icon, false)] = { iconPath: `${icons}/dark/${icon}.svg` }
    defs[def(icon, true)] = { iconPath: `${icons}/light/${icon}.svg` }
  }
  const map = (m: Record<string, Icon>, light: boolean) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, def(v, light)]))
  const layer = (base: ThemeLayer | undefined, light: boolean) => ({
    ...base,
    fileExtensions: { ...base?.fileExtensions, ...map(assoc.fileExtensions, light) },
    fileNames: { ...base?.fileNames, ...map(assoc.fileNames, light) },
  })
  const { iconDefinitions: _d, light, ...rest } = seti
  return { ...rest, iconDefinitions: defs, ...layer(rest, false), light: layer(light, true) }
}

/** Material Icon Theme takes `*.ext` or a name, the value a path without `.svg` relative to its `dist` folder. */
export function materialSettings(assoc: Associations, iconPath: (icon: Icon) => string, folderPath: string) {
  const files: Record<string, string> = {}
  for (const [k, v] of Object.entries(assoc.fileExtensions)) if (!k.includes('/')) files[`*.${k}`] = iconPath(v)
  for (const [k, v] of Object.entries(assoc.fileNames)) files[k] = iconPath(v)
  const folders: Record<string, string> = {}
  for (const k of Object.keys(assoc.folderNames)) folders[path.basename(k)] = folderPath
  return { 'material-icon-theme.files.associations': files, 'material-icon-theme.folders.associations': folders }
}

export interface VsiconsEntry {
  icon: string
  extensions: string[]
  filename?: boolean
  light?: boolean
  format: 'svg'
}

export const vsiconsName = (icon: Icon) => `pcbjs_${icon}`

/** vscode-icons matches a bare name or extension; its icons are `file_type_<icon>.svg` in its custom icon folder. */
export function vsiconsSettings(assoc: Associations) {
  const byIcon = (m: Record<string, Icon>, filename: boolean): VsiconsEntry[] => {
    const groups = new Map<Icon, string[]>()
    for (const [k, v] of Object.entries(m)) if (!k.includes('/') || filename) groups.set(v, [...(groups.get(v) ?? []), path.basename(k)])
    return [...groups].map(([icon, extensions]) => ({
      icon: vsiconsName(icon),
      extensions: [...new Set(extensions)],
      ...(filename ? { filename: true } : {}),
      light: true,
      format: 'svg' as const,
    }))
  }
  const folders = [...new Set(Object.keys(assoc.folderNames).map(k => path.basename(k)))]
  return {
    files: [...byIcon(assoc.fileExtensions, false), ...byIcon(assoc.fileNames, true)],
    folders: folders.length ? [{ icon: vsiconsName('fab'), extensions: folders, format: 'svg' as const }] : [],
  }
}
