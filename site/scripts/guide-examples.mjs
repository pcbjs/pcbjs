import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const generated = join(repo, 'site/.gallery/guide')
const template = join(repo, 'packages/cli/templates/examples/blinky')
const read = file => readFileSync(file, 'utf8')
const clean = text => text.replace(/^.*#(?:end)?region.*\n/gm, '').trimEnd() + '\n'
const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name.startsWith('.') || e.name === 'node_modules' ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  )

/** Remove complete JSX children, preserving the surrounding module and its real imports. */
export function withoutChildren(code, keep) {
  const source = ts.createSourceFile('pcb.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  function visit(node) {
    if (ts.isJsxElement(node) && ['PCB', 'g'].includes(node.openingElement.tagName.getText(source))) {
      for (const child of node.children) {
        if (ts.isJsxText(child)) continue
        if (ts.isJsxExpression(child) && !child.expression) {
          edits.push([child.pos, child.end])
          continue
        }
        if (!keep(child.getText(source))) edits.push([child.pos, child.end])
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const [a, b] of edits.sort((a, b) => b[0] - a[0])) code = code.slice(0, a) + code.slice(b)
  return code.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
}

function blinky() {
  const all = Object.fromEntries(
    walk(template)
      .filter(p => /\.(tsx?|json)$/.test(p) && !p.endsWith('package.json'))
      .map(p => [relative(template, p), clean(read(p))]),
  )
  const base = all['pcb.tsx']
  const stages = [
    ['schematic', 'Blinky schematic', ['outline', 'parts', 'groups'], 'sch', 'blinky.sch.tsx', ['export const', '<Schematic>', '<J1', '<Q1', '<C1', 'channel(CH']],
    ['board', 'Board outline', ['outline'], '2d', 'pcb.tsx', ['<PCB', 'Edge.Cuts']],
    ['placement', 'Individual placements', ['outline', 'parts'], '2d', 'pcb.tsx', ['<J1', '<Q1', '<C1']],
    ['groups', 'Reusable channel placements', ['outline', 'parts', 'groups'], '2d', 'pcb.tsx', ['<LedChannelRow']],
    ['manual', 'Manual copper', ['outline', 'parts', 'groups', 'manual'], '2d', 'pcb.tsx', ["route('3 10')", "route('9 5')", "route('22.2 5')"]],
    ['automatic', 'Automatic SIG route', ['all'], '2d', 'pcb.tsx', ['route(J1[3]']],
    ['hybrid', 'Hybrid SIG route', ['all'], '2d', 'pcb.tsx', ['route(J1[3]']],
    ['checks', 'Completed Blinky', ['all'], 'checks', 'pcb.tsx', ['<PCB', 'route(', 'pour(']],
  ]
  return stages.map(([step, title, keep, initialView, activeFile, focus]) => {
    const files = { ...all }
    if (!keep.includes('all'))
      files['pcb.tsx'] = withoutChildren(
        base,
        text =>
          (keep.includes('outline') && text.includes('layer="Edge.Cuts"')) ||
          (keep.includes('parts') && /^<(J1|Q1|C1)\b/.test(text)) ||
          (keep.includes('groups') && /^<LedChannelRow\b/.test(text)) ||
          (keep.includes('manual') && /^\{(?:route\('|via\()/.test(text)),
      )
    if (!keep.includes('all') && !keep.includes('manual')) files['lib/led-channel.tsx'] = withoutChildren(files['lib/led-channel.tsx'], text => /^<g\.(R|D)\b/.test(text))
    if (step === 'board') {
      files['pcb.tsx'] = `import PCB from '@pcbjs/core'
import { roundedRect } from '@pcbjs/lib'

const W = 30, H = 20

export default (
  <PCB name="Blinky" rev="0.1.0" rules={{ clearance: 0.2, minTrackWidth: 0.2 }}>
    <path layer="Edge.Cuts" d={roundedRect(W, H, 2)} />
  </PCB>
)
`
      for (const name of Object.keys(files)) if (!['pcb.tsx', 'pcb.config.ts', 'tsconfig.json'].includes(name)) delete files[name]
    }
    if (step === 'placement') {
      files['pcb.tsx'] = files['pcb.tsx'].replace(/^import .*LedChannelRow.*\n/m, '')
      files['blinky.sch.tsx'] = files['blinky.sch.tsx']
        .replace(/^import .*led-channel.*\n/m, '')
        .replace(/^export const CH[123].*\n/gm, '')
        .replace(/const channel = [\s\S]*?\n\)\n/, '')
        .replace(/^.*(?:channel\(CH|wire\(CH|<Text).*\n/gm, '')
      files['blinky.sourcing.ts'] = files['blinky.sourcing.ts']
        .replace(', CH1, CH2, CH3', '')
        .replace(/^for \(const ch.*\n/gm, '')
        .replace(/^.*330 Ω.*\n/gm, '')
      for (const name of Object.keys(files)) if (name.includes('led-channel')) delete files[name]
    }
    if (step === 'automatic') files['pcb.tsx'] = files['pcb.tsx'].replace(/\{route\(J1\[3\], Q1\[1\]\)[^\n]+/, '{route(J1[3], Q1[1]).width(0.25)}')
    if (!keep.includes('all')) files['pcb.tsx'] = `// ${title}. Coordinates are millimetres, x right and y down.\n` + files['pcb.tsx'].replace(/^(?:\/\/[^\n]*\n)+/, '')
    return {
      id: `blinky-${step}`,
      title,
      files,
      entry: 'pcb.tsx',
      activeFile,
      focus: { [activeFile]: focus },
      views: initialView === 'sch' ? ['sch'] : step === 'checks' ? ['2d', '3d', 'sch', 'checks'] : ['2d', '3d', 'sch'],
      initialView,
    }
  })
}

export function fencedExamples(markdown, page) {
  const out = []
  const re = /^```tsx\s+([^\n]*\bpreview=([\w-]+)[^\n]*)\n([\s\S]*?)^```\s*$/gm
  for (const match of markdown.matchAll(re)) {
    const lines = match[1].match(/\{([\d, -]+)\}/)?.[1] ?? ''
    const focus = lines.split(',').flatMap(part => {
      if (!part.trim()) return []
      const [a, b = a] = part.trim().split('-').map(Number)
      return Array.from({ length: b - a + 1 }, (_, i) => a + i)
    })
    if (!/export default\s*\(/.test(match[3])) throw new Error(`${page}: ${match[2]} must be a complete board module`)
    out.push({
      id: match[2],
      title: /<PCB\s+name="([^"]+)"/.exec(match[3])?.[1] ?? match[2],
      files: { 'pcb.tsx': match[3] },
      entry: 'pcb.tsx',
      activeFile: 'pcb.tsx',
      focus: { 'pcb.tsx': focus },
      views: ['2d', '3d'],
      initialView: '2d',
      page,
    })
  }
  return out
}

export function guideExamples() {
  const markdown = [...walk(join(repo, 'site/guide')), ...readdirSync(join(repo, 'docs')).map(f => join(repo, 'docs', f))].filter(p => p.endsWith('.md'))
  const examples = [...blinky(), ...markdown.flatMap(p => fencedExamples(read(p), relative(repo, p)))]
  const ids = new Set()
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error(`Duplicate guide preview: ${example.id}`)
    ids.add(example.id)
    const dir = join(generated, example.id)
    example.file = join(dir, example.entry)
    const config = "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n"
    const files = { 'pcb.config.ts': config, 'tsconfig.json': read(join(template, 'tsconfig.json')), ...example.files }
    for (const [name, code] of Object.entries(files)) {
      const path = join(dir, name)
      mkdirSync(dirname(path), { recursive: true })
      if (!existsSync(path) || read(path) !== code) writeFileSync(path, code)
    }
  }
  return examples
}

/** Rendering and compilation consume the same complete fence, never the home-page board. */
export function guideFences(md) {
  const fence = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const id = /^tsx\s+[^\n]*\bpreview=([\w-]+)/.exec(token.info)?.[1]
    return id ? `<GuideDemo example="${id}" />\n` : fence(tokens, index, options, env, self)
  }
}
