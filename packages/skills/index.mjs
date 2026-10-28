import fs from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const skillsDir = dirname(fileURLToPath(import.meta.url))
export const agentsDir = join('.agents', 'skills')
export const claudeDir = join('.claude', 'skills')

export const skillNames = () =>
  fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(join(skillsDir, d.name, 'SKILL.md')))
    .map(d => d.name)
    .sort()

export function describe(name) {
  const head = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8'))?.[1] ?? ''
  return /^description:\s*(.*)$/m.exec(head)?.[1].replace(/^(['"])(.*)\1$/, '$2') ?? ''
}

const real = p => {
  try {
    return fs.realpathSync(p)
  } catch {
    return resolve(p)
  }
}
const present = p => {
  try {
    return !!fs.lstatSync(p)
  } catch {
    return false
  }
}

/** This package's folder as seen from the node_modules of a project above `dir`, or null when no project there installs it. */
export function projectSkills(dir) {
  const own = real(skillsDir)
  for (let at = resolve(dir); ; at = dirname(at)) {
    const here = join(at, 'node_modules', '@pcbjs', 'skills')
    if (fs.existsSync(here) && real(here) === own) return here
    if (dirname(at) === at) return null
  }
}

function place(source, path, link) {
  fs.rmSync(path, { recursive: true, force: true })
  if (link) {
    try {
      fs.symlinkSync(relative(dirname(path), source), path, 'dir')
      return 'link'
    } catch {
      /* no symlinks here, such as Windows without developer mode */
    }
  }
  fs.cpSync(source, path, { recursive: true })
  return 'copy'
}

export function install(cwd, { to, claude = true } = {}) {
  const into = resolve(cwd, to ?? agentsDir)
  if (real(into) === real(skillsDir)) throw new Error(`pcbjs-skills: ${into} is the package's own folder`)
  const pkg = projectSkills(into)
  const dir = to === undefined && claude ? resolve(cwd, claudeDir) : null
  fs.mkdirSync(into, { recursive: true })
  if (dir) fs.mkdirSync(dir, { recursive: true })
  const shared = dir && real(dir) === real(into)
  return skillNames().map(name => {
    const dest = join(into, name)
    const updated = present(dest)
    const kind = place(join(pkg ?? skillsDir, name), dest, !!pkg)
    const source = kind === 'link' ? join(pkg, name) : dest
    const path = dir && join(dir, name)
    const companion = !dir ? null : shared ? { path, kind: 'shared' } : { path, kind: place(source, path, true) }
    return { name, dest, updated, kind, companion }
  })
}

export function installLine(s, cwd) {
  const head = `${s.updated ? 'updated  ' : 'installed'}  ${s.name}  ${s.kind} ${relative(cwd, s.dest)}`
  return s.companion ? `${head}  ${s.companion.kind} ${relative(cwd, s.companion.path)}` : head
}
