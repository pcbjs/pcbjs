import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { guideExamples, generated, repo } from './guide-examples.mjs'
import { highlight, palette } from './highlight.mjs'

const run = promisify(execFile)
const read = file => readFileSync(file, 'utf8')
const hash = text => createHash('sha256').update(text).digest('hex')
function engineKey() {
  const h = createHash('sha256')
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) h.update(relative(repo, p)).update(readFileSync(p))
    }
  }
  for (const pkg of ['core', 'compile', 'export', 'lib', 'cli']) walk(join(repo, 'packages', pkg, 'src'))
  for (const file of ['guide-compile.mjs', 'preview-svg.mjs', 'source-map.mjs']) h.update(read(join(repo, 'site/scripts', file)))
  return h.digest('hex')
}

export async function guideData() {
  const examples = guideExamples()
  const engine = engineKey()
  const boards = {}
  const sources = {}
  const pal = palette()
  // A separate compiler process keeps each example's defaults and identity realm isolated.
  for (const e of examples) {
    const dir = dirname(e.file),
      meta = join(dir, 'preview.json'),
      output = join(dir, 'compiled.json'),
      stamp = join(dir, 'compiled.hash')
    const json = JSON.stringify(e),
      key = hash(engine + json)
    if (!existsSync(output) || !existsSync(stamp) || read(stamp) !== key) {
      writeFileSync(meta, json)
      try {
        await run(process.execPath, [join(repo, 'site/scripts/guide-compile.mjs'), meta, output], { cwd: dir, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
      } catch (error) {
        throw new Error(`Guide example ${e.id} did not compile: ${error.stderr || error.message}`)
      }
      writeFileSync(stamp, key)
    }
    const data = JSON.parse(read(output))
    data.files = data.files.map(file => {
      const key = hash(file.code).slice(0, 16)
      if (!sources[key])
        sources[key] = {
          code: file.code,
          html: highlight(file.code, 'tsx', pal)
            .split('\n')
            .map((line, i) => line.replace('class="line"', `class="line" data-line="${i + 1}"`))
            .join('\n'),
        }
      const { code, ...rest } = file
      return { ...rest, source: key }
    })
    boards[e.id] = data
  }
  return { boards, sources, css: pal.css() }
}
