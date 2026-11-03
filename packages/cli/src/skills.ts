// skills from the @pcbjs/skills the project resolves, so the command and the installed skills never disagree
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerAgents, type Harness } from './agent-config.js'

interface SkillsPackage {
  skillsDir: string
  skillNames(): string[]
  describe(name: string): string
  install(cwd: string, opts?: { to?: string; claude?: boolean }): Installed[]
  installLine(s: Installed, cwd: string): string
}

interface Installed {
  name: string
  dest: string
  updated: boolean
  kind: 'link' | 'copy'
  companion: { path: string; kind: 'link' | 'copy' | 'shared' } | null
}

async function load(cwd: string): Promise<SkillsPackage | null> {
  for (const from of [join(cwd, 'package.json'), import.meta.url]) {
    try {
      return (await import(pathToFileURL(createRequire(from).resolve('@pcbjs/skills')).href)) as SkillsPackage
    } catch {
      /* the next place */
    }
  }
  return null
}

/** The command. Returns the exit code. */
export async function skills(action: string, opts: { to?: string; claude?: boolean; hooks?: boolean; mcp?: Harness[]; cwd?: string } = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  const pkg = await load(cwd)
  if (!pkg) {
    console.error('pcbjs skills: @pcbjs/skills is not installed here; npm install -D @pcbjs/skills')
    return 1
  }
  if (action === 'install') {
    for (const s of pkg.install(cwd, { to: opts.to, claude: opts.claude })) console.log(pkg.installLine(s, cwd))
    // a skills folder of its own, such as ~/.agents/skills, is no project to register in
    if (opts.to === undefined)
      for (const w of registerAgents(cwd, { claude: opts.claude, hooks: opts.hooks, mcp: opts.mcp })) console.log(`wrote      ${w.what.padEnd(18)} ${w.file}`)
  } else if (action === 'list') {
    for (const n of pkg.skillNames()) console.log(`${n.padEnd(32)}  ${pkg.describe(n)}`)
  } else if (action === 'path') {
    console.log(pkg.skillsDir)
  } else {
    console.error(`pcbjs skills: unknown action ${action}, use install, list or path`)
    return 1
  }
  return 0
}
