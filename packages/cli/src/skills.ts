// skills from the @pcbjs/skills the project resolves, so this command and its pcbjs-skills bin never disagree
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface SkillsPackage {
  skillsDir: string
  skillNames(): string[]
  describe(name: string): string
  install(to: string): { name: string; dest: string; updated: boolean }[]
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
export async function skills(action: string, opts: { to?: string; cwd?: string } = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  const pkg = await load(cwd)
  if (!pkg) {
    console.error('pcbjs skills: @pcbjs/skills is not installed here; npm install -D @pcbjs/skills')
    return 1
  }
  if (action === 'install') {
    for (const s of pkg.install(resolve(cwd, opts.to ?? join('.claude', 'skills')))) console.log(`${s.updated ? 'updated  ' : 'installed'}  ${s.name}  ${relative(cwd, s.dest)}`)
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
