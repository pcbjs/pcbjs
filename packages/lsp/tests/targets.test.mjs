// Target resolution: what the innermost token at a cursor names on the boards, by declaration and type, on a fixture with
// parts, pads, nets, a group, a circuit instance, points, a reference and a schematic namespace; then the same through
// a real dev server: the hover image, the target of `pcbjs:cursor` and a viewer click on a pad selecting its key.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dev } from '@pcbjs/cli/server'
import { resolveFile, scopeInject } from '@pcbjs/compile/scope'
import { projects } from '../dist/project.js'
import { padSource, targetAt } from '../dist/target.js'
import { makeTargets } from './fixtures/targets.mjs'
import { initParams, posOf, viteClient, waitFor } from './fixtures/client.mjs'

const PORT = 5264
let root, server, boards, code

before(async () => {
  root = makeTargets()
  server = await dev({ root, port: PORT, host: '127.0.0.1' })
  server.config.logger.info = () => {}
  boards = []
  for (const name of ['Targets', 'Ns']) boards.push({ root, site: await (await fetch(`http://127.0.0.1:${PORT}/__pcbjs/${name}/board.json`)).json() })
  code = projects({ get: () => undefined })
})

after(async () => {
  code?.dispose()
  await server?.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

/** The target at the n-th `needle` plus `delta` characters, as kind and the name per board. */
function at(file, needle, delta, n = 0) {
  const path = join(root, file),
    text = readFileSync(path, 'utf8')
  const p = posOf(text, needle, delta, n)
  const offset =
    text
      .split('\n')
      .slice(0, p.line)
      .reduce((s, l) => s + l.length + 1, 0) + p.character
  const t = targetAt(code.program(path), path, offset, boards)
  return t ? { kind: t.kind, names: Object.fromEntries(t.boards.map(b => [b.board, b.name])), text: text.slice(t.start, t.end), boards: t.boards } : null
}

const CASES = [
  // file, needle, delta, kind, name on the board, the code it spans
  ['main.tsx', '<D1 ', 2, 'part', { Targets: 'D1' }, 'D1'],
  ['main.tsx', 'D1.K', 1, 'part', { Targets: 'D1' }, 'D1'],
  ['main.tsx', 'D1.K', 2, 'pad', { Targets: 'D1.1' }, 'D1.K'],
  ['main.tsx', "'24.375", 3, 'point', { Targets: '24.375 17.6' }, "'24.375 17.6 B.Cu'"],
  ['main.tsx', 'D1[2]', 1, 'part', { Targets: 'D1' }, 'D1'],
  ['main.tsx', 'D1[2]', 3, 'pad', { Targets: 'D1.2' }, 'D1[2]'],
  ['main.tsx', 'pad(2)', 2, 'pad', { Targets: 'R1.2' }, 'P1.R3.pad(2)'],
  ['main.tsx', '<P1.R3', 2, 'group', { Targets: 'P1' }, 'P1'],
  ['main.tsx', '<P1.R3', 5, 'part', { Targets: 'R1' }, 'R3'],
  ['main.tsx', '<CH1.R', 3, 'group', { Targets: 'CH1' }, 'CH1'],
  ['main.tsx', '"5 15"', 2, 'point', { Targets: '5 15' }, '"5 15"'],
  ['main.tsx', "'12 25'", 2, 'point', { Targets: '12 25' }, "'12 25'"],
  ['main.tsx', 'pour(GND', 6, 'net', { Targets: 'GND' }, 'GND'],
  ['main.tsx', "reference('./", 3, 'reference', { Targets: 'Other' }, null],
  ['main.tsx', '{ J1', 3, 'part', { Targets: 'J1' }, 'J1'],
  ['board.sch.ts', 'GND, VCC, SIG }', 1, 'net', { Targets: 'GND' }, 'GND'],
  ['board.sch.ts', 'J1 =', 1, 'part', { Targets: 'J1' }, 'J1'],
  ['board.sch.ts', 'A: SIG', 1, 'pad', { Targets: 'D1.2' }, 'A: SIG'],
  ['board.sch.ts', 'A: SIG', 4, 'net', { Targets: 'SIG' }, 'SIG'],
  ['board.sch.ts', 'P1 =', 1, 'group', { Targets: 'P1' }, 'P1'],
  ['board.sch.ts', 'R3:', 1, 'part', { Targets: 'R1' }, 'R3'],
  ['board.sch.ts', 'CH1 =', 1, 'group', { Targets: 'CH1' }, 'CH1'],
  ['board.sch.ts', 'mid)', 1, 'net', { Targets: 'CH1/mid' }, 'mid'],
  ['ns.tsx', '<sch.D2', 5, 'part', { Ns: 'D2' }, 'sch.D2'],
  ['ns.tsx', 'sch.D2.A', 6, 'pad', { Ns: 'D2.2' }, 'sch.D2.A'],
  ['ns.tsx', 'R2[1]', 3, 'pad', { Ns: 'R2.1' }, 'sch.R2[1]'],
]

for (const [file, needle, delta, kind, names, span] of CASES) {
  test(`${file}: ${needle} +${delta} is the ${kind} ${Object.values(names)[0]}`, () => {
    const t = at(file, needle, delta)
    assert.ok(t, 'no target')
    assert.equal(t.kind, kind)
    assert.deepEqual(t.names, names)
    if (span) assert.equal(t.text, span)
  })
}

test('a cursor just outside a token resolves to the construct around it', () => {
  // before the D of <D1: the element, which the source range answers
  assert.equal(at('main.tsx', '<D1 ', 1), null)
  // after the K of D1.K and inside `route`: the route call, which the source range answers
  assert.equal(at('main.tsx', 'D1.K', 4), null)
  assert.equal(at('main.tsx', 'route(D1.K', 2), null)
  // right after the D1 of D1.K, before the dot: still not the part
  assert.equal(at('main.tsx', 'D1.K', 2).kind, 'pad')
})

test('pour( names no target: as for a route, its source range answers with the zone', () => {
  assert.equal(at('main.tsx', 'pour(GND', 2), null)
  assert.equal(at('main.tsx', 'pour(GND', 5), null)
  assert.equal(at('main.tsx', 'pour(GND', 6).kind, 'net')
  const text = readFileSync(join(root, 'main.tsx'), 'utf8')
  const p = posOf(text, 'pour(GND', 0)
  const site = boards[0].site
  const r = site.sources['main.tsx'].find(r => r.start[0] === p.line + 1 && r.start[1] === p.character + 1)
  assert.ok(
    text
      .split('\n')
      [p.line].slice(p.character, r.end[1])
      .match(/^pour\(GND, .*\)$/),
  )
  assert.deepEqual(
    r.ids.map(id => site.items.find(i => i.id === id).kind),
    ['zone'],
  )
})

test('ids: a pad is one pad item, a net all its copper, a part and a group their refs', () => {
  const site = boards[0].site
  const pad = at('main.tsx', 'D1.K', 2).boards[0]
  assert.equal(pad.ids.length, 1)
  assert.deepEqual(pad.refs, [])
  assert.equal(site.items.find(i => i.id === pad.ids[0]).ref, 'D1')
  const net = at('main.tsx', 'pour(GND', 6).boards[0]
  assert.ok(net.ids.length > 1 && net.ids.every(id => site.items.find(i => i.id === id).net === 'GND'))
  assert.deepEqual(at('main.tsx', '<CH1.R', 3).boards[0].refs.sort(), ['C1', 'R2'])
  assert.deepEqual(at('main.tsx', '<D1 ', 2).boards[0].refs, ['D1'])
  assert.deepEqual(at('main.tsx', '"5 15"', 2).boards[0].points, [[5, 15]])
})

test("a schematic namespace brought into scope by the compiler's injection: bare names resolve through it", () => {
  const file = join(root, 'bare.tsx'),
    text = readFileSync(file, 'utf8')
  const inj = projects({ get: () => undefined }, (f, t) => {
    const r = scopeInject(t, resolveFile, f)
    return r && { text: r.code, at: r.at, length: r.text.length }
  })
  try {
    const find = (needle, delta) => {
      const t = targetAt(inj.program(file), file, inj.toService(file, text.indexOf(needle) + delta), boards)
      return t && { kind: t.kind, name: t.boards.map(b => b.name).join(), text: text.slice(inj.fromService(file, t.start), inj.fromService(file, t.end)) }
    }
    assert.deepEqual(find('<D2', 2), { kind: 'part', name: 'D2', text: 'D2' })
    assert.deepEqual(find('D2.A', 3), { kind: 'pad', name: 'D2.2', text: 'D2.A' })
  } finally {
    inj.dispose()
  }
})

test("the tag of a part element inside <Schematic> names no target: hover and highlight are its symbol's", () => {
  assert.equal(at('main.tsx', '<D1 at="4', 2), null)
  assert.equal(at('main.tsx', '<D1 at="4', 6), null)
})

test("padSource: the key of a pad in its part's connect call", () => {
  const key = (ref, num) => {
    const s = padSource(f => code.service(f), boards[0], ref, num)
    return s && readFileSync(s.file, 'utf8').slice(s.start, s.end)
  }
  assert.equal(key('D1', '1'), 'K')
  assert.equal(key('J1', '2'), 'VCC')
})

test('through the dev server: hover images, the cursor target and a pad click', async () => {
  const client = await viteClient(PORT)
  try {
    const file = join(root, 'main.tsx'),
      uri = pathToFileURL(file).href,
      text = readFileSync(file, 'utf8')
    await client.conn.sendRequest('initialize', initParams(root))
    await client.conn.sendNotification('initialized', {})
    await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
    const hover = async (needle, delta) =>
      (await client.conn.sendRequest('textDocument/hover', { textDocument: { uri }, position: posOf(text, needle, delta) }))?.contents.value ?? ''
    assert.match(await hover('D1.K', 1), /^!\[footprint on Targets\]/)
    assert.match(await hover('D1.K', 2), /^!\[pad on Targets\][^]*pad \*\*D1\.1\*\* K/)
    assert.match(await hover("'24.375", 3), /^!\[point on Targets\][^]*point 24\.375, 17\.6 mm/)
    assert.match(await hover('<CH1.R', 3), /^!\[group on Targets\]/)
    assert.match(await hover('pour(GND', 6), /^!\[net on Targets\]/)
    assert.match(await hover("reference('./", 3), /^!\[reference on Targets\]/)
    assert.match(await hover('<D1 at="4', 2), /^!\[schematic on Targets\][^]*symbol \*\*D1\*\*/)
    const bare = join(root, 'bare.tsx'),
      bareText = readFileSync(bare, 'utf8'),
      bareUri = pathToFileURL(bare).href
    await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri: bareUri, languageId: 'typescriptreact', version: 1, text: bareText } })
    const h = await client.conn.sendRequest('textDocument/hover', { textDocument: { uri: bareUri }, position: posOf(bareText, 'D2.A', 3) })
    assert.match(h.contents.value, /^!\[pad on Ns\][^]*pad \*\*D2\.2\*\* A/)
    assert.equal(bareText.split('\n')[h.range.start.line].slice(h.range.start.character, h.range.end.character), 'D2.A')

    const cursors = []
    client.ws.on('message', raw => {
      const m = JSON.parse(raw.toString())
      if (m.event === 'pcbjs:cursor') cursors.push(m.data)
    })
    await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri }, position: posOf(text, 'D1.K', 2) })
    const c = await waitFor(h => {
      const t = setInterval(() => {
        if (cursors.length) {
          clearInterval(t)
          h(cursors[0])
        }
      }, 20)
    })
    assert.equal(c.target.kind, 'pad')
    assert.equal(c.target.boards[0].name, 'D1.1')

    const select = waitFor(h => client.conn.onNotification('pcbjs/select', h))
    await fetch(`http://127.0.0.1:${PORT}/__pcbjs/open?file=main.tsx&line=8&col=5&pad=D1.1&board=Targets`)
    const sel = await select
    const sch = readFileSync(join(root, 'board.sch.ts'), 'utf8').split('\n')
    assert.ok(sel.uri.endsWith('/board.sch.ts'))
    assert.equal(sch[sel.range.start.line].slice(sel.range.start.character, sel.range.end.character), 'K')
  } finally {
    client.close()
  }
})
