import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (error) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw error
    }
  },
})
function component(name) {
  const file = new URL(`../src/${name}.vue`, import.meta.url)
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file.pathname })
  const compiled = compileScript(descriptor, { id: `${name}-test`, inlineTemplate: true, templateOptions: { ssr: true } })
  const js = ts.transpileModule(compiled.content, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
  const code = js
    .replace(/import Bubble from ['"]\.\/Bubble\.vue['"];?/, 'const Bubble = {}')
    .replace(
      /from (["'])([^"']+)\1/g,
      (_, quote, spec) =>
        `from ${JSON.stringify(spec.endsWith('.vue') ? component(spec.split('/').at(-1).slice(0, -4)) : spec.startsWith('.') ? new URL(spec + '.ts', file).href : import.meta.resolve(spec))}`,
    )
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const { default: EditBar } = await import(component('EditBar'))

const render = async node => {
  const tl = {
    rw: ref(true),
    tools: ref([{ id: node.caps.includes('chain') ? 'point' : 'move' }]),
    targets: () => ({ refs: [node.ref], node }),
    node: ref(node),
    banner: ref(null),
    why: ref(null),
    grid: ref({ pitch: 1 }),
    sourceGrid: ref({ pitch: 1, minor: [] }),
    gridPitch: ref(null),
    snapOverride: ref(null),
    snapEnabled: ref(true),
    oneShot() {},
  }
  const app = createSSRApp({ render: () => h(EditBar, { tl, as: { on: ref(false), ends: ref(null), chip: ref(null) }, chip: {} }) })
  app.provide(Symbol.for('pcbjs:pane'), {
    commands: { run() {} },
    pane: { mode: '2d' },
    board: {
      invalid: {},
      sel: { refs: [node.ref], anchor: node.caps.includes('chain') ? `${node.ref}/pt:1` : node.ref },
      site: {
        layers: [
          { id: 'F.Cu', kind: 'copper' },
          { id: 'B.Cu', kind: 'copper' },
        ],
      },
      edit: {},
    },
  })
  return renderToString(app)
}

test('placement toolbar shows frame coordinates, units, side and grid without tool modes', async () => {
  const html = await render({ ref: 'R1', caps: ['placed', 'layered'], at: [12, 5, 0], side: 'F', m: [1, 0, 0, 1, 16, 5] })
  assert.match(html, /aria-label="Placement"/)
  assert.match(html, /aria-label="Placement X"/)
  assert.match(html, /value="-4mm"/)
  assert.match(html, /aria-label="Placement rotation"/)
  assert.match(html, /aria-label="Placement side"/)
  assert.match(html, /aria-label="Editing grid"/)
  assert.match(html, /aria-label="Reset view"/)
  assert.doesNotMatch(html, />Move<|>Rotate<|Written|instances follow/)
})

test('trace toolbar reports lowercase relative state and selected stage layer', async () => {
  const html = await render({ ref: 'route:1', caps: ['chain'], m: [1, 0, 0, 1, 0, 0], steps: [{ op: 'h', layer: 'B.Cu' }] })
  assert.match(html, /aria-label="Trace"/)
  assert.match(html, /aria-label="Trace primitive"/)
  assert.match(html, /select value="h"/)
  assert.match(html, /type="checkbox" checked/)
  assert.match(html, /select value="B.Cu"/)
  assert.doesNotMatch(html, /Placement X/)
})
