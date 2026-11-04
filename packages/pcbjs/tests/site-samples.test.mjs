// Every TypeScript sample on the docs site's own pages in site/ type checks as a module of its own, as the skill samples do.
// The README shows the created board; the guide compiles complete progressive source modules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { guideExamples } from '../../../site/scripts/guide-examples.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const site = join(repo, 'site')
const scripts = new Set(['ts', 'tsx', 'js', 'mjs'])
const skip = new Set(['node_modules', '.vitepress', '.shots', 'public', 'brand', 'data', 'scripts'])

const markdown = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? (skip.has(d.name) ? [] : markdown(join(dir, d.name))) : d.name.endsWith('.md') ? [join(dir, d.name)] : [],
  )

/** The fenced blocks of a markdown file: `{ lang, code, line }`, line the 1-based line of the first code line. */
function samples(text) {
  const out = []
  const re = /^```(\w+)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm
  for (let m; (m = re.exec(text));) out.push({ lang: m[1], code: m[2], line: text.slice(0, m.index).split('\n').length + 1 })
  return out
}

test('site: every TypeScript sample on a site page type checks', async () => {
  const ts = (await import('typescript')).default
  const work = join(here, `.site-samples-${process.pid}`)
  const origin = new Map()
  try {
    for (const md of markdown(site)) {
      const dir = join(work, relative(site, md).replace(/[\\/.[\]]/g, '_'))
      samples(readFileSync(md, 'utf8'))
        .filter(s => scripts.has(s.lang))
        .forEach((s, i) => {
          const file = join(dir, `sample${i}.${s.lang}`)
          mkdirSync(dir, { recursive: true })
          writeFileSync(file, s.code)
          origin.set(file, { md: relative(repo, md), line: s.line })
        })
    }
    const program = ts.createProgram([...origin.keys()], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: '@pcbjs/core',
      skipLibCheck: true,
      types: [],
    })
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter(d => d.file && origin.has(resolve(d.file.fileName)))
      .map(d => {
        const { md, line } = origin.get(resolve(d.file.fileName))
        const at = d.file.getLineAndCharacterOfPosition(d.start ?? 0)
        return `${md}:${line + at.line}:${at.character + 1}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
      })
    assert.deepEqual(errors, [])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

/** The lines between `// #region example` and `// #endregion example` of a file, as VitePress includes them. */
const region = file => /^\/\/ #region example\n([\s\S]*?)^\/\/ #endregion example$/m.exec(readFileSync(join(repo, file), 'utf8'))?.[1]

test('site: README matches the template and guide uses complete progressive sources', () => {
  const template = readFileSync(join(repo, 'packages/cli/templates/board/pcb.tsx'), 'utf8')
  assert.equal(samples(readFileSync(join(repo, 'README.md'), 'utf8')).find(s => s.lang === 'tsx')?.code, template)
  const examples = guideExamples()
  const board = examples.find(e => e.id === 'blinky-board')
  const placement = examples.find(e => e.id === 'blinky-placement')
  assert.match(board.files['pcb.tsx'], /export default \(/)
  assert.doesNotMatch(board.files['pcb.tsx'], /<J1|route\(/)
  assert.match(placement.files['pcb.tsx'], /<J1 at="3 8"/)
  assert.match(placement.files['blinky.sch.tsx'], /export const J1/)
  assert.doesNotMatch(placement.files['pcb.tsx'], /<LedChannelRow|route\(/)
  assert.match(readFileSync(join(site, 'guide/getting-started/placement.md'), 'utf8'), /<GuideDemo example="blinky-placement"/)
})
