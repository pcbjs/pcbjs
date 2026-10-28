// `pcbjs model add|align|check` on a small project: a local file added, fitted and written into the part's options, a file
// downloaded from a local http server with its source noted, check's flags for a file that is off its courtyard, missing or
// unreadable, and the code edits of --write on their own.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { modelSnippet, noteSource, unzipModel, writeElementModel, writePartModel } from '../dist/model.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const KICAD = join(REPO, 'examples', 'highspeed', 'models')
const PORT = 5278

const PCB = `import PCB from '@pcbjs/core'
import { R0603, PinHeader } from '@pcbjs/lib'

const R1 = R0603('10k')
const R2 = R0603({ value: '1k', model: { file: './models/R.step', offset: [3, 0, 0] } })
const R3 = R0603({ value: '2k', model: { file: './models/nowhere.step' } })
const R4 = R0603({ value: '3k', model: { file: './models/bad.glb' } })
const J1 = PinHeader(4)

export default (
  <PCB name="Models">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <R1 at="5 5" /><R2 at="10 5" /><R3 at="15 5" /><R4 at="20 5" />
    <J1 at="10 12" />
  </PCB>
)
`

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-model-')))
mkdirSync(join(root, 'node_modules'))
mkdirSync(join(root, 'models'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
writeFileSync(join(root, 'pcb.tsx'), PCB)
copyFileSync(join(KICAD, 'R_0603_1608Metric.step'), join(root, 'models', 'R.step'))
writeFileSync(join(root, 'models', 'bad.glb'), 'glTF but not really')
mkdirSync(join(root, 'downloads'))
copyFileSync(join(KICAD, 'PinHeader_1x04_P2.54mm_Vertical.step'), join(root, 'downloads', 'header.step'))
after(() => rmSync(root, { recursive: true, force: true }))

const run = (...args) => {
  const r = spawnSync(process.execPath, [BIN, 'model', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

test('check lists every footprint with its source and flags files off the courtyard, missing or unreadable', () => {
  const r = run('check')
  assert.equal(r.code, 1, r.err)
  assert.match(r.out, /J1\s+generated header\s+ok/)
  assert.match(r.out, /R1\s+generated chip\s+ok/)
  assert.match(r.out, /R2\s+file models\/R\.step\s+off: model box reaches 2\.\d mm past the courtyard at \+x/)
  assert.match(r.out, /fix: pcbjs model align R2/)
  assert.match(r.out, /R3\s+file models\/nowhere\.step\s+missing: the file is missing/)
  assert.match(r.out, /fix: pcbjs model add <file-or-url> --ref R3/)
  assert.match(r.out, /R4\s+file models\/bad\.glb\s+unread: the file did not read/)
  assert.match(r.out, /5 footprints, 3 with a model file, 2 generated, 0 with no model, 3 flagged/)
})

test('align prints the transform that undoes a wrong offset', () => {
  const r = run('align', 'R2')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /pins 2, 2 on 2 pads/)
  assert.match(r.out, /now  offset \[3, 0, 0\] rotate \[0, 0, 0\]\n/)
  assert.match(r.out, /model: \{ file: '\.\/models\/R\.step' \}/)
  assert.match(r.out, /look: pcbjs shot --view 3d --select R2/)
})

test('add copies a local file, notes it, fits it to a part and writes the model option into the part call', () => {
  const r = run('add', 'downloads/header.step', '--ref', 'J1', '--write')
  assert.equal(r.code, 0, r.err)
  assert.ok(existsSync(join(root, 'models', 'header.step')))
  assert.match(r.out, /added models\/header\.step  STEP/)
  assert.match(r.out, /box  x .* 2\.54 x 10\.16 x 11\.54 mm/)
  assert.match(r.out, /pins 4, 4 on 4 pads/)
  assert.match(r.out, /model: \{ file: '\.\/models\/header\.step' \}/)
  assert.match(readFileSync(join(root, 'pcb.tsx'), 'utf8'), /const J1 = PinHeader\(4, \{ model: \{ file: '\.\/models\/header\.step' \} \}\)/)
  assert.match(readFileSync(join(root, 'models', 'LICENSES.md'), 'utf8'), /- `header\.step`: local file .*downloads\/header\.step, added \d{4}-\d\d-\d\d/)
  // the board reads the written option: J1 now has a model file that fits
  assert.match(run('check').out, /J1\s+file models\/header\.step\s+ok/)
  // the same file again is no change; other content under the name needs --force
  assert.match(run('add', 'downloads/header.step').out, /have models\/header\.step/)
  writeFileSync(join(root, 'downloads', 'header.step'), readFileSync(join(KICAD, 'R_0603_1608Metric.step')))
  assert.match(run('add', 'downloads/header.step').err, /exists with other content/)
})

test('add downloads a URL, takes the name from the URL, and notes the URL as the source', async () => {
  const body = readFileSync(join(KICAD, 'R_0603_1608Metric.step'))
  const server = createServer((req, res) => {
    if (req.url === '/dl/R_0603.step') {
      res.setHeader('content-type', 'application/octet-stream')
      res.end(body)
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise(r => server.listen(PORT, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${PORT}/dl/R_0603.step`
    const r = await new Promise(resolve => {
      // spawned, not spawnSync, so this process's server can answer the download
      const child = spawn(process.execPath, [BIN, 'model', 'add', url, '--ref', 'R1', '--as', 'r0603'], { cwd: root, env: { ...process.env, NO_COLOR: '1' } })
      let out = '',
        err = ''
      child.stdout.on('data', d => {
        out += d
      })
      child.stderr.on('data', d => {
        err += d
      })
      child.on('close', code => resolve({ code, out, err }))
    })
    assert.equal(r.code, 0, r.err)
    assert.ok(existsSync(join(root, 'models', 'r0603.step')))
    assert.match(r.out, /added models\/r0603\.step/)
    assert.match(r.out, /model: \{ file: '\.\/models\/r0603\.step' \}/)
    assert.match(r.out, /paste it into the options of R1 at pcb\.tsx:4/)
    assert.match(readFileSync(join(root, 'models', 'LICENSES.md'), 'utf8'), new RegExp(`- \`r0603\\.step\`: ${url.replace(/[.]/g, '\\.')}, added`))
    const miss = await new Promise(resolve => {
      const child = spawn(process.execPath, [BIN, 'model', 'add', `http://127.0.0.1:${PORT}/nothing.step`], { cwd: root })
      let err = ''
      child.stderr.on('data', d => {
        err += d
      })
      child.on('close', code => resolve({ code, err }))
    })
    assert.equal(miss.code, 1)
    assert.match(miss.err, /HTTP 404/)
  } finally {
    server.close()
  }
})

test('--write edits: a value becomes { value, model }, an options object gets or replaces the key, an element gets the attribute', () => {
  const s = modelSnippet('./models/x.step', { offset: [1, 0, -0.5], rotate: [0, 0, 90], scale: [1, 1, 1] })
  assert.equal(s, "{ file: './models/x.step', offset: [1, 0, -0.5], rotate: [0, 0, 90] }")
  assert.equal(modelSnippet('./m.glb', { offset: [0, 0, 0], rotate: [0, 0, 0], scale: [25.4, 25.4, 25.4] }), "{ file: './m.glb', scale: [25.4, 25.4, 25.4] }")
  const code = "const R1 = R0603('10k').connect(A, B)\nconst U1 = QFN(48, 7, 0.5)('KSZ')\nconst R2 = R0603({ value: '1k', model: { step: 'old.step' } })\nconst R3 = R0603()\n"
  const m = "{ file: 'x.step' }"
  assert.equal(writePartModel(code, 'a.ts', 1, 12, m).split('\n')[0], "const R1 = R0603({ value: '10k', model: { file: 'x.step' } }).connect(A, B)")
  assert.equal(writePartModel(code, 'a.ts', 2, 12, m).split('\n')[1], "const U1 = QFN(48, 7, 0.5)({ value: 'KSZ', model: { file: 'x.step' } })")
  assert.equal(writePartModel(code, 'a.ts', 3, 12, m).split('\n')[2], "const R2 = R0603({ value: '1k', model: { file: 'x.step' } })")
  assert.equal(writePartModel(code, 'a.ts', 4, 12, m).split('\n')[3], "const R3 = R0603({ model: { file: 'x.step' } })")
  assert.equal(writePartModel('x = 1\n', 'a.ts', 1, 1, m), null)
  const el = '  <footprint id="eth:RJ45" value="JK" {...rest}>\n  </footprint>\n'
  assert.equal(writeElementModel(el, 'a.tsx', 1, 3, m).split('\n')[0], `  <footprint model={${m}} id="eth:RJ45" value="JK" {...rest}>`)
  const had = '<footprint ref="J1" model={{ step: "a.step" }} />\n'
  assert.equal(writeElementModel(had, 'a.tsx', 1, 1, m), `<footprint ref="J1" model={${m}} />\n`)
})

const zipOf = files => {
  const entry = (name, data, local) => {
    const n = Buffer.from(name),
      d = deflateRawSync(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(d.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(d.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(n.length, 28)
    ch.writeUInt32LE(local, 42)
    return { local: Buffer.concat([lh, n, d]), central: Buffer.concat([ch, n]) }
  }
  let off = 0
  const parts = files.map(([n, d]) => {
    const e = entry(n, d, off)
    off += e.local.length
    return e
  })
  const cd = Buffer.concat(parts.map(p => p.central))
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(off, 16)
  return new Uint8Array(Buffer.concat([...parts.map(p => p.local), cd, end]))
}

test('a zip is unpacked to its first model file, STEP before WRL, with its licence files', () => {
  const got = unzipModel(
    zipOf([
      ['readme.txt', Buffer.from('hi')],
      ['3D/part.wrl', Buffer.from('#VRML V2.0 utf8\n')],
      ['3D/part.stp', Buffer.from('ISO-10303-21;')],
      ['3D/drawing.pdf', Buffer.from('%PDF')],
    ]),
  )
  assert.equal(got.name, 'part.stp')
  assert.equal(Buffer.from(got.data).toString(), 'ISO-10303-21;')
  assert.deepEqual(
    got.terms.map(t => t.name),
    ['readme.txt'],
  )
})

test('add of a zipped download saves the licence file it ships and names it in LICENSES.md', async () => {
  const zip = zipOf([
    ['Read me.pdf', Buffer.from('%PDF no redistribution')],
    ['HR10.stp', readFileSync(join(KICAD, 'R_0603_1608Metric.step'))],
  ])
  const server = createServer((req, res) => {
    res.setHeader('content-disposition', 'attachment; filename="hr10.zip"')
    res.end(zip)
  })
  await new Promise(r => server.listen(PORT, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${PORT}/documents?path=%2Fmodel`
    const r = await new Promise(resolve => {
      const child = spawn(process.execPath, [BIN, 'model', 'add', url], { cwd: root, env: { ...process.env, NO_COLOR: '1' } })
      let out = '',
        err = ''
      child.stdout.on('data', d => {
        out += d
      })
      child.stderr.on('data', d => {
        err += d
      })
      child.on('close', code => resolve({ code, out, err }))
    })
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /licence  Read me\.pdf came in the zip, saved as models\/HR10-Read_me\.pdf/)
    assert.equal(readFileSync(join(root, 'models', 'HR10-Read_me.pdf'), 'utf8'), '%PDF no redistribution')
    assert.match(readFileSync(join(root, 'models', 'LICENSES.md'), 'utf8'), /`HR10\.stp`: .*; the zip's Read me\.pdf is HR10-Read_me\.pdf, added/)
  } finally {
    server.close()
  }
})

test('LICENSES.md gets a header once and one line per file and source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-lic-'))
  try {
    noteSource(dir, 'a.step', 'https://x/a.step', '2026-01-02')
    noteSource(dir, 'a.step', 'https://x/a.step', '2026-01-03')
    noteSource(dir, 'b.wrl', 'local file /tmp/b.wrl', '2026-01-03')
    const md = readFileSync(join(dir, 'LICENSES.md'), 'utf8')
    assert.match(md, /^# Model sources\n/)
    assert.equal(md.match(/^- /gm).length, 2)
    assert.match(md, /- `a\.step`: https:\/\/x\/a\.step, added 2026-01-02\n- `b\.wrl`: local file \/tmp\/b\.wrl, added 2026-01-03\n$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
