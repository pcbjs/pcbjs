import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const skillsDir = resolve(dirname(fileURLToPath(import.meta.url)), 'skills')

export const skillNames = () => readdirSync(skillsDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(skillsDir, d.name, 'SKILL.md')))
  .map(d => d.name)
  .sort()

export function describe(name) {
  const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8'))?.[1] ?? ''
  return /^description:\s*(.*)$/m.exec(head)?.[1].replace(/^(['"])(.*)\1$/, '$2') ?? ''
}

export function install(to) {
  return skillNames().map(name => {
    const dest = join(to, name)
    const updated = existsSync(dest)
    rmSync(dest, { recursive: true, force: true })
    cpSync(join(skillsDir, name), dest, { recursive: true })
    return { name, dest, updated }
  })
}
