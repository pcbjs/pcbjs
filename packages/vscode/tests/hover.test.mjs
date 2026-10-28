// The hover provider side: vscode-languageclient's own protocol converter, with a stand-in for the vscode module, turns a
// pcbjs hover into a MarkdownString with the markdown options the extension passes, the preview image intact and first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { MARKDOWN, HOVER_LIMIT, hoverImage } = require('../dist/hover.cjs')

/** The parts of the vscode module the converter touches for a hover; any other name is a plain class it may extend. */
const known = {
  MarkdownString: class {
    constructor(value = '') {
      this.value = value
    }
    appendText(t) {
      this.value += t
      return this
    }
    appendMarkdown(t) {
      this.value += t
      return this
    }
  },
  Hover: class {
    constructor(contents, range) {
      this.contents = Array.isArray(contents) ? contents : [contents]
      this.range = range
    }
  },
  Range: class {
    constructor(a, b, c, d) {
      this.start = { line: a, character: b }
      this.end = { line: c, character: d }
    }
  },
  Position: class {
    constructor(line, character) {
      this.line = line
      this.character = character
    }
  },
  Uri: { parse: s => ({ toString: () => s }) },
}
const vscode = new Proxy(known, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) })

function converter() {
  const resolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    return request === 'vscode' ? 'vscode' : resolve.call(this, request, ...rest)
  }
  require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode }
  try {
    const { createConverter } = require('vscode-languageclient/lib/common/protocolConverter.js')
    return createConverter(undefined, MARKDOWN.isTrusted, MARKDOWN.supportHtml)
  } finally {
    Module._resolveFilename = resolve
  }
}

/** A hover as the pcbjs language server sends it: the image, then the text. */
function serverHover(svgBytes) {
  let d = 'M0 0'
  while (d.length < svgBytes) d += 'L12 34 56 78'
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='240' viewBox='0 0 720 480' data-box='1 2 3 2'><path d='${d}'/></svg>`
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  return {
    contents: { kind: 'markdown', value: `![placement on Blinky](${uri})\n\n**Q1** MMBT3904 · pcbjs:SOT-23 · at 26, 10 mm · front\n\nDrew 7 pads on Blinky` },
    range: { start: { line: 22, character: 4 }, end: { line: 22, character: 21 } },
  }
}

test('the extension converts hovers with HTML and images allowed and commands untrusted', () => {
  assert.deepEqual(MARKDOWN, { isTrusted: false, supportHtml: true })
})

test('a pcbjs hover reaches the editor as one MarkdownString with the image first and the text after, unchanged', async () => {
  const p2c = converter()
  const sent = serverHover(56000)
  const hover = await p2c.asHover(sent)
  assert.equal(hover.contents.length, 1)
  const md = hover.contents[0]
  assert.ok(md instanceof vscode.MarkdownString)
  assert.equal(md.value, sent.contents.value)
  assert.equal(md.supportHtml, true)
  assert.equal(md.isTrusted, false)
  assert.ok(md.value.length < HOVER_LIMIT, `${md.value.length} characters`)
  const img = hoverImage(md.value)
  assert.equal(img?.type, 'svg')
  assert.match(Buffer.from(img.uri.split(',')[1], 'base64').toString(), /^<svg xmlns='http:\/\/www.w3.org\/2000\/svg' width='360'/)
  assert.deepEqual(
    [hover.range.start, hover.range.end],
    [
      { line: 22, character: 4 },
      { line: 22, character: 21 },
    ],
  )
  // a hover without an image passes as it is
  assert.equal(hoverImage('**pcbjs at** of `J1`'), undefined)
})
