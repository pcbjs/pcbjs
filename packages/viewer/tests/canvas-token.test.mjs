// One canvas colour per theme behind 2D, 3D and the schematic, from --canvas in style.css; the boot screen falls back to the same values.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
const css = src('style.css'), boot = src('boot.css'), view3d = src('View3D.vue')
const blocks = [...css.matchAll(/(:root[^{]*)\{([^}]*)\}/g)].filter(m => /--canvas:/.test(m[2])).map(m => ({ sel: m[1].trim(), body: m[2] }))
const token = (body, k) => new RegExp(`${k}:\\s*([^;]+);`).exec(body)?.[1].trim()

test('every theme sets the canvas, its page surface and the three grid tones', () => {
  assert.equal(blocks.length, 4, 'light, dark by the system, dark by choice, high contrast')
  for (const b of blocks) for (const k of ['--canvas', '--canvas-page', '--grid-minor', '--grid-major', '--grid-origin']) assert.ok(token(b.body, k), `${k} in ${b.sel}`)
  const light = blocks[0].body, dark = blocks.find(b => b.sel.includes('[data-theme="dark"]')).body
  assert.notEqual(token(light, '--canvas'), token(dark, '--canvas'))
  assert.equal(token(blocks.find(b => b.sel.includes('prefers') || b.sel.includes(':not')).body, '--canvas'), token(dark, '--canvas'))
})

test('the 2D stage, the schematic and the 3D view paint var(--canvas), the 3D scene and its fog read it', () => {
  assert.match(css, /\.stage \{[^}]*background: var\(--canvas\)/)
  assert.match(css, /\.sch-view \{[^}]*background: var\(--canvas\)/)
  assert.doesNotMatch(css, /\.sch-view[^{]*\{[^}]*background: [^;]*sch-paper/)
  assert.match(view3d, /\.view3d \{[^}]*background: var\(--canvas/)
  assert.match(view3d, /token\('--canvas'\)/)
  assert.match(view3d, /scene\.background = bg/)
  assert.match(view3d, /new THREE\.Fog\(bg/)
})

test("the inlined boot screen falls back to the theme's own canvas", () => {
  const light = token(blocks[0].body, '--canvas'), dark = token(blocks.find(b => b.sel.includes('[data-theme="dark"]')).body, '--canvas')
  assert.ok(boot.includes(`var(--canvas, light-dark(${light}, ${dark}))`))
})
