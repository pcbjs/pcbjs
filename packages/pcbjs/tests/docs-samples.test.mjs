// Every TypeScript and JavaScript sample in docs/*.md and the README compiles, on the harness of skill-samples: each fenced
// block is a module of its own, and `ts file=lib/pinout.ts` names the path another block of the same file imports it by.
// Docs show fragments, so a block gets one prelude line: an import of each @pcbjs/core and @pcbjs/lib name it uses without
// importing or declaring it, then `any` for the example nets, refs and types it uses undeclared, such as GND, Q1 or Stats.
// The program runs over the scope host of `pcbjs check`, so a board may use the bare names of its schematic module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scopeHost, sourcePosition } from '@pcbjs/compile/scope'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const scripts = new Set(['ts', 'tsx', 'js', 'mjs'])
const pages = [...readdirSync(join(repo, 'docs')).filter(f => f.endsWith('.md')).map(f => join(repo, 'docs', f)), join(repo, 'README.md')]
// names a sample may use as placeholders: nets and refs in capitals, and the report's types
const REF = /^(BT|SW|TP|[CDEFHJKLQRUY])\d+$/
const PLACEHOLDER = /^([A-Z][A-Z0-9_]*|Stats|Timings|Routing|Finding)$/
// the README's example is the region of the demo's blinky.pcb.tsx, which pcbjs check type checks in place
const blinky = /^\/\/ #region example\n([\s\S]*?)^\/\/ #endregion example$/m.exec(readFileSync(join(repo, 'examples/demo/blinky.pcb.tsx'), 'utf8'))?.[1]

/** The fenced blocks of a markdown file: `{ lang, file, code, line }`, line the 1-based line of the first code line. */
function samples(text) {
  const out = []
  const re = /^```(\w+)([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm
  for (let m; (m = re.exec(text));) {
    out.push({ lang: m[1], file: /\bfile=(\S+)/.exec(m[2])?.[1], code: m[3], line: text.slice(0, m.index).split('\n').length + 1 })
  }
  return out
}

const owns = (code, n) => new RegExp(`import[^;\\n]*\\b${n}\\b|\\b(const|let|var|function|class|type|interface)\\s+${n}\\b|\\b(const|let|var)\\s*[{[][^=]*\\b${n}\\b[^=]*[}\\]]\\s*=|\\(\\s*\\{[^)]*\\b${n}\\b[^)]*\\}`).test(code)
const uses = (code, n) => new RegExp(`(?<![\\w.$'"])${n}\\b`).test(code)

test('docs: every TypeScript and JavaScript sample type checks', async () => {
  const ts = (await import('typescript')).default
  const exported = [['@pcbjs/core', Object.keys(await import('@pcbjs/core'))], ['@pcbjs/lib', Object.keys(await import('@pcbjs/lib'))]]
  const work = join(here, `.docs-samples-${process.pid}`)
  const blocks = new Map()
  // a ref such as Q1 is a part, so route(Q1[1]) takes the builder overload; any other placeholder is any
  const stub = n => REF.test(n) ? `declare const ${n}: import('@pcbjs/core').Part & { [pin: string]: any }` : `declare const ${n}: any`
  const prelude = (code, missing = []) => {
    const lines = []
    if (/<PCB\b/.test(code) && !owns(code, 'PCB')) lines.push(`import PCB from '@pcbjs/core'`)
    const seen = new Set(['default'])
    for (const [from, names] of exported) {
      const take = names.filter(n => !seen.has(n) && uses(code, n) && !owns(code, n))
      take.forEach(n => seen.add(n))
      if (take.length) lines.push(`import { ${take.join(', ')} } from '${from}'`)
    }
        for (const n of missing) lines.push(stub(n), `type ${n} = any`)
    // bare JSX children, such as a few placed parts, become one fragment
    if (/^\s*</.test(code) && !/^(import|export)\b/m.test(code)) lines.push('export default <>')
    return lines.join('; ') + '\n'
  }
  const body = code => (/^\s*</.test(code) && !/^(import|export)\b/m.test(code) ? code + '</>\n' : code)
  const options = {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: '@pcbjs/core',
    allowJs: true, checkJs: false, allowImportingTsExtensions: true, skipLibCheck: true, types: ['node'],
  }
  let injections
  const run = () => {
    const scope = scopeHost(options, work)
    injections = scope.injections
    const program = ts.createProgram([...blocks.keys()], options, scope.host)
    return ts.getPreEmitDiagnostics(program).filter(d => d.file && blocks.has(resolve(d.file.fileName)))
  }
  try {
    for (const md of pages) {
      const dir = join(work, relative(repo, md).replace(/[\\/.]/g, '_'))
      samples(readFileSync(md, 'utf8')).filter(s => scripts.has(s.lang) && s.code !== blinky).forEach((s, i) => {
        const file = join(dir, s.file ?? `sample${i}.${s.lang}`)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, prelude(s.code) + body(s.code))
        blocks.set(file, { md: relative(repo, md), line: s.line, code: s.code })
      })
      // a module of another page's example, imported by name: a stub with those names
      for (const [file, b] of blocks) {
        if (!file.startsWith(dir + '/')) continue
        for (const m of b.code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
          const target = resolve(dirname(file), m[2])
          if (['.ts', '.tsx', ''].some(x => blocks.has(target + x))) continue
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target + '.ts', m[1].split(',').map(n => n.trim()).filter(Boolean).map(n => `export ${stub(n)}`).join('\n') + '\n')
        }
      }
    }
    assert.ok(blocks.size > 40, `only ${blocks.size} samples found`)
    // a second pass declares the placeholders the first found undeclared
    const missing = new Map()
    for (const d of run()) {
      const n = /^(?:Cannot find name|No value exists in scope for the shorthand property) '(\w+)'/.exec(ts.flattenDiagnosticMessageText(d.messageText, '\n'))?.[1]
      const f = resolve(d.file.fileName)
      if (n && PLACEHOLDER.test(n)) missing.set(f, new Set([...(missing.get(f) ?? []), n]))
    }
    for (const [f, ns] of missing) writeFileSync(f, prelude(blocks.get(f).code, [...ns]) + body(blocks.get(f).code))
    const errors = run().map(d => {
      const { md, line } = blocks.get(resolve(d.file.fileName))
      const at = sourcePosition(d, injections) ?? { line: 1, col: 1 }
      return `${md}:${line + at.line - 2}:${at.col}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
    })
    console.log(`docs samples: ${blocks.size} blocks from ${pages.length} pages`)
    assert.deepEqual(errors, [])
  } finally { rmSync(work, { recursive: true, force: true }) }
})
