#!/usr/bin/env node
// Usage: sync-changelog.mjs [--out <file>] [CHANGELOG.md...] copies the Migration sections into the pcbjs-upgrade skill; default reads the root and packages/*.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(pkg, '..', '..')
const heading = /^(\s*)(#{1,6})\s+(.*)$/

/** The Migration sections of one changelog: `{ version, body }` per section, the body dedented to its heading. */
export function migrations(text) {
  const out = []
  const lines = text.split('\n')
  let version = null
  for (let i = 0; i < lines.length; i++) {
    const v = /^##\s+v?(\d+\.\d+\.\d+\S*)/.exec(lines[i])
    if (v) {
      version = v[1]
      continue
    }
    const h = heading.exec(lines[i])
    if (!version || !h || !/^migration\b/i.test(h[3])) continue
    const [indent, level] = [h[1].length, h[2].length]
    const body = []
    for (i++; i < lines.length; i++) {
      const l = lines[i]
      const next = heading.exec(l)
      if (next && next[2].length <= level) break
      if (l.trim() && l.length - l.trimStart().length < indent) break
      body.push(l.slice(Math.min(indent, l.length - l.trimStart().length)))
    }
    i--
    const text = body.join('\n').trim()
    if (text) out.push({ version, body: text })
  }
  return out
}

const minorOf = v => v.split('.').slice(0, 2).join('.')
const byVersion = (a, b) => b.localeCompare(a, 'en', { numeric: true })

/** The reference file for the sections of `logs`, `[{ name, text }]`: one heading per minor, one per version under it. */
export function render(logs) {
  const seen = new Map()
  for (const { name, text } of logs)
    for (const { version, body } of migrations(text)) {
      const key = `${version}\n${body}`
      if (seen.has(key)) seen.get(key).names.add(name)
      else seen.set(key, { version, body, names: new Set([name]) })
    }
  const head =
    '# Migrations from the changelog\n\nGenerated from the Migration sections of CHANGELOG.md by `scripts/sync-changelog.mjs` when the package is packed. The notes from before the changelog are in pre-0.1.md.\n'
  if (!seen.size) return `${head}\nNo release has a Migration section yet.\n`
  const minors = new Map()
  for (const s of [...seen.values()].sort((a, b) => byVersion(a.version, b.version))) {
    const m = minorOf(s.version)
    if (!minors.has(m)) minors.set(m, [])
    minors.get(m).push(s)
  }
  const parts = [...minors].map(([m, list]) => [`## ${m}`, ...list.map(s => `### ${s.version}, ${[...s.names].join(', ')}\n\n${s.body}`)].join('\n\n'))
  return `${head}\n${parts.join('\n\n')}\n`
}

function changelogs() {
  const dirs = [repo, ...readdirSync(join(repo, 'packages')).map(d => join(repo, 'packages', d))]
  return dirs.map(d => join(d, 'CHANGELOG.md')).filter(existsSync)
}

function nameOf(file) {
  const json = join(dirname(file), 'package.json')
  return existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')).name : 'pcbjs'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } })
  const out = resolve(values.out ?? join(pkg, 'pcbjs-upgrade', 'references', 'changelog.md'))
  const files = positionals.length ? positionals.map(f => resolve(f)) : changelogs()
  const text = render(files.map(f => ({ name: nameOf(f), text: readFileSync(f, 'utf8') })))
  if (!existsSync(out) || readFileSync(out, 'utf8') !== text) writeFileSync(out, text)
  console.log(`sync-changelog  ${files.length} changelogs  ${out}`)
}
