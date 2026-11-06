// Keyboard commands, native editing and host forwarding.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { KEYS, commandBus, commandOf, forHost, search, shown } = await import('../src/keys.ts')

const ev = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods })

test('keys: the plan’s keys are in the table', () => {
  const of = key => commandOf(ev(key), true)?.id
  assert.equal(of('r'), 'rotate')
  assert.equal(of('M'), 'move')
  assert.equal(of('v'), 'view')
  assert.equal(of('g'), 'grid')
  assert.equal(of('i'), 'isolate')
  assert.equal(of('Escape'), 'up')
  assert.equal(of('/'), 'palette')
  assert.equal(of('?'), 'help')
  assert.equal(commandOf(ev('z', { metaKey: true }), true)?.id, 'undo')
  assert.equal(commandOf(ev('z', { ctrlKey: true }), false)?.id, 'undo')
  assert.equal(commandOf(ev('Z', { metaKey: true, shiftKey: true }), true)?.id, 'redo')
  assert.equal(commandOf(ev('z', { ctrlKey: true, shiftKey: true }), false)?.id, 'redo')
  assert.equal(commandOf(ev('?', { shiftKey: true }), true)?.id, 'help')
  assert.equal(commandOf(ev('r', { metaKey: true }), true), null)
  assert.equal(shown('Mod+Z', true), '⌘Z')
})

test('keys: ids and keys are unique, gestures are listed but never a key', () => {
  assert.equal(new Set(KEYS.map(d => d.id)).size, KEYS.length)
  const keys = KEYS.filter(d => !d.gesture).flatMap(d => d.keys)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(KEYS.some(d => d.gesture && d.keys.includes('Shift+Click')))
  assert.equal(commandOf(ev('Shift'), true), null)
})

test('keys: the palette search matches title, id and key', () => {
  assert.deepEqual(
    search('rotate').map(d => d.id),
    ['rotate'],
  )
  assert.ok(search('grid').some(d => d.id === 'grid'))
  assert.equal(search('no such thing').length, 0)
})

test('keys: the bus runs the newest handler first and falls through when it declines', () => {
  const bus = commandBus()
  const ran = []
  bus.on('up', () => (ran.push('page'), true))
  const off = bus.on('up', () => (ran.push('view'), false))
  assert.equal(bus.run('up'), true)
  off()
  bus.run('up')
  assert.deepEqual(ran, ['view', 'page', 'page'])
  assert.equal(bus.run('nothing'), false)
})

/** A window of one keydown listener and a key event as the browser makes it, recording what the listener did to it. */
function keyTarget() {
  let fn
  return {
    target: { addEventListener: (_, f) => (fn = f) },
    press(key, mods = {}, inField = false) {
      const e = {
        ...ev(key, mods),
        code: `Key${key.toUpperCase()}`,
        keyCode: key.toUpperCase().charCodeAt(0),
        shiftKey: !!mods.shiftKey,
        repeat: false,
        defaultPrevented: false,
        stopped: false,
        target: { closest: () => inField },
        preventDefault() {
          this.defaultPrevented = true
        },
        stopImmediatePropagation() {
          this.stopped = true
        },
      }
      fn(e)
      return e
    },
  }
}

test('keys: the bus takes only the chords of its table, every other one passes untouched and goes to the host', () => {
  const bus = commandBus()
  const host = []
  bus.forward(e => host.push(`${e.metaKey ? 'cmd+' : ''}${e.shiftKey ? 'shift+' : ''}${e.key}`))
  bus.on('undo', () => true)
  bus.on('rotate', () => true)
  const w = keyTarget()
  bus.listen(w.target, true)
  for (const [key, mods] of [
    ['p', { metaKey: true }],
    ['P', { metaKey: true, shiftKey: true }],
    ['b', { metaKey: true }],
    ['F1', {}],
  ]) {
    const e = w.press(key, mods)
    assert.equal(e.defaultPrevented, false, `${key} is not prevented`)
    assert.equal(e.stopped, false, `${key} is not stopped`)
  }
  assert.deepEqual(host, ['cmd+p', 'cmd+shift+P', 'cmd+b', 'F1'])
  const z = w.press('z', { metaKey: true })
  assert.ok(z.defaultPrevented && z.stopped, 'a chord of the table is taken')
  const r = w.press('r')
  assert.ok(r.defaultPrevented, 'R is taken')
  w.press('x')
  assert.equal(host.length, 4, 'a plain key and a taken chord stay with the page')
  w.press('c', { metaKey: true }, true)
  w.press('p', { metaKey: true }, true)
  assert.deepEqual(host.slice(4), ['cmd+p'], 'a field keeps its clipboard chords, cmd+P still reaches the host')
  assert.equal(forHost(ev('p', { ctrlKey: true }), false), true)
  assert.equal(forHost(ev('g'), false), false)
})

test('modal forwarding keeps host chords and native field editing without running board commands', () => {
  const bus = commandBus()
  const host = []
  let ran = 0
  bus.forward(e => host.push(e.key))
  bus.on('undo', () => (++ran, true))
  bus.on('grid', () => (++ran, true))
  const modal = (key, mods, field, mac = true) => {
    const e = { ...ev(key, mods), target: { closest: () => field }, defaultPrevented: false }
    bus.forwardModal(e, mac)
  }
  for (const field of [false, true]) {
    modal('s', { metaKey: true }, field)
    modal('p', { ctrlKey: true }, field, false)
    modal('F1', {}, field)
    modal('g', {}, field)
    modal('z', { metaKey: true }, field)
  }
  for (const key of ['a', 'c', 'v', 'x', 'y', 'z']) modal(key, { metaKey: true }, true)
  assert.deepEqual(host, ['s', 'p', 'F1', 's', 'p', 'F1'])
  assert.equal(ran, 0)
})
