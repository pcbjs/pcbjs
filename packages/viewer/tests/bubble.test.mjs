// The cursor-following bubble and the editor-cursor chip appear and move in the frame the pointer or cursor does: no transition, no animation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
/** The declarations of every rule whose selector names `cls`. */
function rules(css, cls) {
  const out = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].includes(cls)) out.push(m[2])
  return out
}
const MOTION = /\b(transition|animation)(-[a-z-]+)?\s*:/

test('the 3D hover bubble has no transition or animation', () => {
  const vue = src('View3D.vue')
  const css = vue.slice(vue.indexOf('<style'))
  assert.ok(rules(css, 'view3d-tip').length, 'the bubble has its rule')
  for (const r of rules(css, 'view3d-tip')) assert.doesNotMatch(r, MOTION)
  for (const r of rules(src('style.css'), 'view3d-tip')) assert.doesNotMatch(r, MOTION)
  assert.doesNotMatch(vue, /<Transition[^>]*>\s*<div[^>]*view3d-tip/)
})

test('the source highlight chip has no transition', () => {
  const app = src('App.vue')
  assert.doesNotMatch(app, /<Transition[^>]*>\s*<button[^>]*src-chip/)
  for (const f of ['style.css', 'App.vue']) for (const r of rules(src(f), 'chip')) assert.doesNotMatch(r, MOTION)
})
