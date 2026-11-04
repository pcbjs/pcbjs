// Target resolution: what the innermost token at a cursor names on the boards, by declaration and type, on a fixture with
// parts, pads, nets, a named <g>, a circuit instance, points, a reference and a schematic namespace; then the same through
// a real dev server: the hover image, the editor's selections becoming the session's selection and a viewer click on a pad
// selecting its key.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dev } from './fixtures/dev.mjs'
import { resolveFile, scopeInject } from '@pcbjs/compile/internal/scope'
import { projects } from '../dist/project.js'
import { padSource, targetAt } from '../dist/target.js'
import { targetPreview } from '../dist/hover-preview.js'
import { makeTargets } from './fixtures/targets.mjs'
import { initParams, posOf, sessionClient, waitFor } from './fixtures/client.mjs'
import { viewerClient } from '../../cli/tests/fixtures/viewer.mjs'

let PORT
let root, server, boards, code

before(async () => {
  root = makeTargets()
  server = await dev({ root, port: 0, host: '127.0.0.1' })
  PORT = server.httpServer.address().port
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
  ['main.tsx', 'D1.K', 2, 'pad', { Targets: 'D1/1' }, 'D1.K'],
  ['main.tsx', "'24.375", 3, 'point', { Targets: '24.375 17.6' }, "'24.375 17.6 B.Cu'"],
  ['main.tsx', 'D1[2]', 1, 'part', { Targets: 'D1' }, 'D1'],
  ['main.tsx', 'D1[2]', 3, 'pad', { Targets: 'D1/2' }, 'D1[2]'],
  ['main.tsx', 'R3[2]', 3, 'pad', { Targets: 'R3/2' }, 'R3[2]'],
  ['main.tsx', '<R3', 2, 'part', { Targets: 'R3' }, 'R3'],
  ['main.tsx', '<CH1.R', 3, 'group', { Targets: 'CH1' }, 'CH1'],
  ['main.tsx', '<CH1.R', 5, 'part', { Targets: 'R1' }, 'CH1.R'],
  ['main.tsx', '"5 15"', 2, 'point', { Targets: '5 15' }, '"5 15"'],
  ['main.tsx', "'12 25'", 2, 'point', { Targets: '12 25' }, "'12 25'"],
  ['main.tsx', 'pour(GND', 6, 'net', { Targets: 'GND' }, 'GND'],
  ['main.tsx', "reference('./", 3, 'reference', { Targets: 'Other' }, null],
  ['main.tsx', '{ J1', 3, 'part', { Targets: 'J1' }, 'J1'],
  ['board.sch.tsx', 'GND, VCC, SIG }', 1, 'net', { Targets: 'GND' }, 'GND'],
  ['board.sch.tsx', 'J1 =', 1, 'part', { Targets: 'J1' }, 'J1'],
  ['board.sch.tsx', 'A: SIG', 1, 'pad', { Targets: 'D1/2' }, 'A: SIG'],
  ['board.sch.tsx', 'A: SIG', 4, 'net', { Targets: 'SIG' }, 'SIG'],
  ['board.sch.tsx', 'R3 =', 1, 'part', { Targets: 'R3' }, 'R3'],
  ['board.sch.tsx', 'CH1 =', 1, 'group', { Targets: 'CH1' }, 'CH1'],
  ['board.sch.tsx', 'mid }', 1, 'net', { Targets: 'CH1/mid' }, 'mid'],
  ['ns.tsx', '<sch.D2', 5, 'part', { Ns: 'D2' }, 'sch.D2'],
  ['ns.tsx', 'sch.D2.A', 6, 'pad', { Ns: 'D2/2' }, 'sch.D2.A'],
  ['ns.tsx', 'R2[1]', 3, 'pad', { Ns: 'R2/1' }, 'sch.R2[1]'],
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
    r.uids.map(u => site.items.find(i => i.uid === u).kind),
    ['zone'],
  )
})

test('ids and refs: a pad is one pad item named R1/2, a net all its copper named net:GND, a part and a group their parts named by ref and path', () => {
  const site = boards[0].site
  const pad = at('main.tsx', 'D1.K', 2).boards[0]
  assert.equal(pad.ids.length, 1)
  assert.deepEqual(pad.parts, [])
  assert.deepEqual(pad.refs, ['D1/1'])
  assert.equal(site.items.find(i => i.id === pad.ids[0]).ref, 'D1')
  const net = at('main.tsx', 'pour(GND', 6).boards[0]
  assert.ok(net.ids.length > 1 && net.ids.every(id => site.items.find(i => i.id === id).net === 'GND'))
  assert.deepEqual(net.refs, ['net:GND'])
  const group = at('main.tsx', '<CH1.R', 3).boards[0]
  assert.deepEqual(group.parts.sort(), ['C1', 'R1'])
  assert.deepEqual(group.refs, ['CH1'])
  assert.deepEqual(at('main.tsx', '<D1 ', 2).boards[0].parts, ['D1'])
  assert.deepEqual(at('main.tsx', '<D1 ', 2).boards[0].refs, ['D1'])
  assert.deepEqual(at('main.tsx', '"5 15"', 2).boards[0].points, [[5, 15]])
  assert.deepEqual(at('main.tsx', '"5 15"', 2).boards[0].refs, [])
  // the hover image of a target names what it shows the same way
  assert.deepEqual(targetPreview(at('main.tsx', 'D1.K', 2), boards).refs, ['D1/1'])
  assert.deepEqual(targetPreview(at('main.tsx', '<CH1.R', 3), boards).refs, ['CH1'])
})

test("a schematic namespace brought into scope by the compiler's injection: bare names resolve through it", () => {
  const file = join(root, 'bare.tsx'),
    text = readFileSync(file, 'utf8')
  const inj = projects({ get: () => undefined }, (f, t) => {
    const r = scopeInject(t, resolveFile, f)
    return r
  })
  try {
    const find = (needle, delta) => {
      const t = targetAt(inj.program(file), file, inj.toInjected(file, text.indexOf(needle) + delta), boards)
      return t && { kind: t.kind, name: t.boards.map(b => b.name).join(), text: text.slice(inj.toSource(file, t.start), inj.toSource(file, t.end)) }
    }
    assert.deepEqual(find('<D2', 2), { kind: 'part', name: 'D2', text: 'D2' })
    assert.deepEqual(find('D2.A', 3), { kind: 'pad', name: 'D2/2', text: 'D2.A' })
  } finally {
    inj.dispose()
  }
})

test("the tag of a part element inside <Schematic> names no target: hover and highlight are its symbol's", () => {
  assert.equal(at('board.sch.tsx', '<D1 at="4', 2), null)
  assert.equal(at('board.sch.tsx', '<D1 at="4', 6), null)
})

test("padSource: the key of a pad in its part's connect call", () => {
  const key = (ref, num) => {
    const s = padSource(f => code.service(f), boards[0], ref, num)
    return s && readFileSync(s.file, 'utf8').slice(s.start, s.end)
  }
  assert.equal(key('D1', '1'), 'K')
  assert.equal(key('J1', '2'), '2')
})

test('through the dev server: hover images, the cursor target and a pad click', async () => {
  const client = await sessionClient(PORT)
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
    assert.match(await hover('D1.K', 2), /^!\[pad on Targets\][^]*pad \*\*D1\/1\*\* K/)
    assert.match(await hover("'24.375", 3), /^!\[point on Targets\][^]*point 24\.375, 17\.6 mm/)
    assert.match(await hover('<CH1.R', 3), /^!\[group on Targets\]/)
    assert.match(await hover('pour(GND', 6), /^!\[net on Targets\]/)
    assert.match(await hover("reference('./", 3), /^!\[reference on Targets\]/)
    const bare = join(root, 'bare.tsx'),
      bareText = readFileSync(bare, 'utf8'),
      bareUri = pathToFileURL(bare).href
    await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri: bareUri, languageId: 'typescriptreact', version: 1, text: bareText } })
    const h = await client.conn.sendRequest('textDocument/hover', { textDocument: { uri: bareUri }, position: posOf(bareText, 'D2.A', 3) })
    assert.match(h.contents.value, /^!\[pad on Ns\][^]*pad \*\*D2\/2\*\* A/)
    assert.equal(bareText.split('\n')[h.range.start.line].slice(h.range.start.character, h.range.end.character), 'D2.A')
    const schFile = join(root, 'board.sch.tsx'),
      schText = readFileSync(schFile, 'utf8'),
      schUri = pathToFileURL(schFile).href
    await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri: schUri, languageId: 'typescriptreact', version: 1, text: schText } })
    const sym = await client.conn.sendRequest('textDocument/hover', { textDocument: { uri: schUri }, position: posOf(schText, '<D1 at="4', 2) })
    assert.match(sym?.contents.value ?? '', /^!\[schematic on Targets\][^]*symbol \*\*D1\*\*/)

    // every editor selection becomes the session's selection for its viewers: the members of each range, the primary's the anchor
    const sels = []
    const viewer = await viewerClient(PORT)
    viewer.on((event, d) => event === 'pcbjs:select' && d.board === 'Targets' && sels.push(d.selection))
    await viewer.observe('Targets')
    const nextSel = () =>
      waitFor(h => {
        const t = setInterval(() => {
          if (sels.length) {
            clearInterval(t)
            h(sels.shift())
          }
        }, 20)
      })
    const caret = p => ({ start: p, end: p })
    const pad = posOf(text, 'D1.K', 2),
      part = posOf(text, '<R3', 2)
    await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri }, position: pad, selections: [caret(pad), caret(part)] })
    const s = await nextSel()
    assert.deepEqual([s.refs, s.anchor, s.by], [['D1/1', 'P1/R3'], 'D1/1', 'editor'])
    // a range over code selects what that code drew; the primary cursor's member stays the anchor
    const from = posOf(text, '<R3', 0)
    await client.conn.sendNotification('pcbjs/focus', {
      textDocument: { uri },
      position: part,
      selections: [caret(part), { start: from, end: { line: from.line + 1, character: 0 } }],
    })
    const r = await nextSel()
    assert.equal(r.anchor, 'P1/R3')
    assert.ok(r.refs.includes('P1/R3'), JSON.stringify(r.refs))
    // a coordinate marks its point while retaining the route expression around it
    const pt = posOf(text, "'24.375", 3)
    await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri }, position: pt, selections: [caret(pt)] })
    const m = await nextSel()
    assert.deepEqual(m.refs, ['route:1'])
    assert.deepEqual(m.marks.points, [[24.375, 17.6]])
    // a cursor in schematic-only code, a wire() or a <Label>, marks the element it drew on the sheet
    for (const [needle, delta, kind] of [
      ['.h(-4)', 4, 'wire'],
      ['<Label', 3, 'label'],
    ]) {
      const p = posOf(schText, needle, delta)
      await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri: schUri }, position: p, selections: [caret(p)] })
      const w = await nextSel()
      assert.deepEqual(w.refs, [], needle)
      assert.equal(w.marks?.sch?.length, 1, JSON.stringify(w))
      assert.match(w.marks.sch[0], new RegExp(`^${kind}:\\d+$`))
    }

    const select = waitFor(h => client.conn.onNotification('pcbjs/select', h))
    await fetch(`http://127.0.0.1:${PORT}/__pcbjs/open?file=main.tsx&line=9&col=5&pad=D1/1&board=Targets`)
    const sel = await select
    const sch = readFileSync(join(root, 'board.sch.tsx'), 'utf8').split('\n')
    const [one] = sel.items
    assert.ok(one.uri.endsWith('/board.sch.tsx'))
    assert.equal(sch[one.ranges[0].start.line].slice(one.ranges[0].start.character, one.ranges[0].end.character), 'K')
    viewer.close()
  } finally {
    client.close()
  }
})

test('pad signature resolves semantic receivers in incomplete accessors, preserves shadowing and excludes arrays', async () => {
  const { padSignature } = await import('../dist/signature.js')
  const file = join(root, 'main.tsx'),
    original = readFileSync(file, 'utf8')
  const docs = new Map()
  const live = projects({ get: f => docs.get(f) })
  let version = 0
  const hint = (marked, snapshots = boards) => {
    const start = original.length + 1,
      offset = marked.indexOf('|')
    docs.set(file, { text: original + '\n' + marked.replace('|', ''), version: ++version })
    return padSignature(live.program(file), file, start + offset, snapshots)
  }
  try {
    for (const input of ['D1[|]', 'D1[|', 'D1[2|]', "D1['A|']", 'sch.D1[|]', 'CH1.R[|]', 'const alias = D1; alias[|]']) {
      const result = hint(input)
      assert.ok(result, input)
      assert.equal(result.activeParameter, 0)
      assert.equal(result.signatures.length, 1)
      assert.match(result.signatures[0].label, /\[pad\]$/)
      assert.equal(result.signatures[0].parameters.length, 1)
      const [start, end] = result.signatures[0].parameters[0].label
      assert.equal(result.signatures[0].label.slice(start, end), 'pad')
      assert.equal(result.signatures[0].documentation.kind, 'markdown')
      assert.match(result.signatures[0].documentation.value, /^!\[Footprint pads\]\(data:image\/svg\+xml;base64,/)
      assert.match(result.signatures[0].documentation.value, /pads: `1`, `2`/)
    }
    const { renderPreview } = await import('../dist/preview.js')
    const site = boards.find(b => b.site.name === 'Targets').site
    if (process.env.PCBJS_SIGNATURE_EVIDENCE) writeFileSync(process.env.PCBJS_SIGNATURE_EVIDENCE, JSON.stringify({ resistor: hint('CH1.R[2|]'), led: hint('D1[2|]') }, null, 2))
    const current = hint('D1[2|]').signatures[0].documentation.value
    assert.ok(current.includes(renderPreview(site, { frame: 'D1', pads: ['2'] }).uri), 'the selected literal pad is outlined in its own numbered footprint frame')
    const foreign = { root: join(root, 'unrelated-project'), site: { ...site, footprints: site.footprints.map(fp => ({ ...fp, pads: [{ ...fp.pads[0], num: 'FOREIGN' }] })) } }
    assert.doesNotMatch(hint('D1[|]', [foreign, ...boards]).signatures[0].documentation.value, /FOREIGN/, 'same-named boards from a different project cannot supply the footprint')
    for (const input of ['const list = [D1]; list[|]', 'function f(D1: number[]) { D1[|] }', 'D1[2]|', 'D1[1 + |2]']) assert.equal(hint(input), null, input)
  } finally {
    live.dispose()
  }
})
