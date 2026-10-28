// Prints the GitHub Release notes of the train in the tree: each package's changelog section for the train version, without dependency bumps.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../packages/', import.meta.url).pathname
const read = (dir, file) => readFileSync(join(root, dir, file), 'utf8')
const train = JSON.parse(read('pcbjs', 'package.json')).version

function section(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.indexOf(`## ${version}`)
  if (start < 0) return []
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

function withoutDependencyBumps(lines) {
  const kept = []
  let skipping = false
  for (const line of lines) {
    if (line.startsWith('- ')) skipping = line.startsWith('- Updated dependencies')
    else if (!line.startsWith(' ') && line.trim()) skipping = false
    if (!skipping) kept.push(line)
  }
  return kept
}

const parts = []
for (const dir of readdirSync(root).sort()) {
  if (!existsSync(join(root, dir, 'CHANGELOG.md'))) continue
  const { name, version } = JSON.parse(read(dir, 'package.json'))
  if (version !== train) continue
  const lines = withoutDependencyBumps(section(read(dir, 'CHANGELOG.md'), version))
  if (!lines.some(line => line.startsWith('- '))) continue
  const body = lines
    .map(line => (line.startsWith('### ') ? `#${line}` : line))
    .join('\n')
    .trim()
  parts.push(`## ${name}\n\n${body}`)
}
process.stdout.write(parts.join('\n\n') + '\n')
