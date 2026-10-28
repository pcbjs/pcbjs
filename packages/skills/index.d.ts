/** The package folder, which holds one folder per skill. */
export declare const skillsDir: string
/** `.agents/skills`, the default install folder, relative to the project. */
export declare const agentsDir: string
/** `.claude/skills`, the folder of the companion links, relative to the project. */
export declare const claudeDir: string
/** The skill names, sorted. */
export declare function skillNames(): string[]
/** The `description` of a skill's frontmatter. */
export declare function describe(name: string): string
/** This package's folder under the `node_modules` of a project above `dir`, or null when no project there installs it. */
export declare function projectSkills(dir: string): string | null
/** `link` is a relative symlink into the project's `node_modules`, `copy` a copied folder, `shared` a `.claude/skills` that already is the install folder. */
export type Kind = 'link' | 'copy' | 'shared'
export interface Installed {
  name: string
  dest: string
  updated: boolean
  kind: 'link' | 'copy'
  companion: { path: string; kind: Kind } | null
}
/** Links every skill from `<cwd>/.agents/skills` and `<cwd>/.claude/skills`, or from `to` alone, to the project's `node_modules`; copies where the package is not in one. Replaces a folder or link of the same name. */
export declare function install(cwd: string, opts?: { to?: string; claude?: boolean }): Installed[]
/** The line `install` prints for one skill, paths relative to `cwd`. */
export declare function installLine(s: Installed, cwd: string): string
