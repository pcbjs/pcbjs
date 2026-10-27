import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const init = require('../dist/index.cjs')
const dir = join(import.meta.dirname, 'fixture')
const PCB = join(dir, 'pcb.tsx')
const SCH = join(dir, 'board.sch.tsx')

function service(edits = {}) {
  const texts = new Map(Object.entries(edits).map(([f, t]) => [join(dir, f), t]))
  const versions = new Map()
  const config = ts.getParsedCommandLineOfConfigFile(join(dir, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
  const host = {
    getCompilationSettings: () => config.options,
    getScriptFileNames: () => config.fileNames,
    getScriptVersion: f => String(versions.get(f) ?? 0),
    getScriptSnapshot: f => {
      const t = texts.get(f) ?? ts.sys.readFile(f)
      return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t)
    },
    getCurrentDirectory: () => dir,
    getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
    fileExists: f => texts.has(f) || ts.sys.fileExists(f),
    readFile: f => texts.get(f) ?? ts.sys.readFile(f),
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  }
  const base = ts.createLanguageService(host)
  const ls = init({ typescript: ts }).create({ languageService: base, languageServiceHost: host, project: undefined, config: {} })
  const edit = (f, t) => { texts.set(f, t); versions.set(f, (versions.get(f) ?? 0) + 1) }
  return { ls, edit, text: f => texts.get(f) ?? readFileSync(f, 'utf8') }
}

const posOf = (text, needle, from = 0) => {
  const i = text.indexOf(needle, from)
  assert.ok(i >= 0, needle)
  return i
}
const errors = ls => [...ls.getSyntacticDiagnostics(PCB), ...ls.getSemanticDiagnostics(PCB)]
const message = d => ts.flattenDiagnosticMessageText(d.messageText, '\n')

test('ts-plugin: the fixture type-checks with the scoped names', () => {
  const { ls } = service()
  assert.deepEqual(errors(ls).map(message), [])
})

test('ts-plugin: quick info on U1.VSSA has the pin type', () => {
  const { ls, text } = service()
  const src = text(PCB)
  const at = posOf(src, 'VSSA')
  const qi = ls.getQuickInfoAtPosition(PCB, at)
  assert.ok(qi, 'quick info')
  assert.equal(src.slice(qi.textSpan.start, qi.textSpan.start + qi.textSpan.length), 'VSSA')
  assert.match(ts.displayPartsToString(qi.displayParts), /VSSA/)
  const u1 = ls.getQuickInfoAtPosition(PCB, posOf(src, 'U1.VSSA'))
  assert.match(ts.displayPartsToString(u1.displayParts), /const U1: /)
})

test('ts-plugin: completions list the exports of the schematic module', () => {
  const src = `import PCB from '@pcbjs/core'\nimport * as sch from './board.sch'\nconst x = \nexport default <PCB name="F" schematic={sch} />\n`
  const { ls } = service({ 'pcb.tsx': src })
  const at = posOf(src, 'const x = ') + 10
  const names = ls.getCompletionsAtPosition(PCB, at, {}).entries.map(e => e.name)
  for (const n of ['U1', 'GND', 'VCC', 'SIG']) assert.ok(names.includes(n), n)
  const details = ls.getCompletionEntryDetails(PCB, at, 'U1', {}, undefined, {}, undefined)
  assert.match(ts.displayPartsToString(details.displayParts), /const U1: /)
  const used = src.replace('const x = ', 'const y = [U1, GND, VCC, SIG]\nconst x = ')
  const { ls: ls2 } = service({ 'pcb.tsx': used })
  const got = ls2.getCompletionsAtPosition(PCB, posOf(used, 'const x = ') + 10, {}).entries.map(e => e.name)
  for (const n of ['U1', 'GND', 'VCC', 'SIG']) assert.ok(got.includes(n), n)
  const dot = used.replace('const x = ', 'const x = U1.')
  const { ls: ls3 } = service({ 'pcb.tsx': dot })
  const pins = ls3.getCompletionsAtPosition(PCB, posOf(dot, 'U1.', posOf(dot, 'const x')) + 3, {}).entries.map(e => e.name)
  for (const n of ['VDD', 'VSSA', 'PA0']) assert.ok(pins.includes(n), n)
})

test('ts-plugin: a name the module does not export is reported at its use', () => {
  const src = readFileSync(PCB, 'utf8').replace('<U1 at="10 10" />', '<U1 at="10 10" />\n    {String(U9)}')
  const { ls } = service({ 'pcb.tsx': src })
  const ds = errors(ls)
  assert.equal(ds.length, 1, ds.map(message).join('\n'))
  assert.equal(message(ds[0]), 'U9 is not exported by ./board.sch')
  assert.equal(ds[0].start, posOf(src, 'U9'))
  assert.equal(ds[0].length, 2)
})

test('ts-plugin: an export the injector misses but TypeScript rejects points at the use', () => {
  const sch = readFileSync(SCH, 'utf8') + 'export type { FootprintProps as U7 } from \'@pcbjs/core\'\nexport { U7 } from \'./nowhere\'\n'
  const src = readFileSync(PCB, 'utf8').replace('<U1 at="10 10" />', '<U1 at="10 10" />\n    {String(U7)}')
  const { ls } = service({ 'pcb.tsx': src, 'board.sch.tsx': sch })
  const d = errors(ls).find(d => message(d).startsWith('U7'))
  assert.ok(d, errors(ls).map(message).join('\n'))
  assert.equal(message(d), 'U7 is not exported by ./board.sch')
  assert.equal(d.start, posOf(src, 'U7)'))
})

test('ts-plugin: positions on the import line round-trip around the insertion', () => {
  const src = `import PCB from '@pcbjs/core'\nimport * as sch from './board.sch'; const k = U1.VSSA\nexport default <PCB name="F" schematic={sch}><U1 at="1 1" /></PCB>\n`
  const { ls } = service({ 'pcb.tsx': src })
  const before = ls.getQuickInfoAtPosition(PCB, posOf(src, 'sch from'))
  assert.equal(before.textSpan.start, posOf(src, 'sch from'))
  const k = posOf(src, 'k = U1')
  const after = ls.getQuickInfoAtPosition(PCB, k)
  assert.equal(after.textSpan.start, k)
  assert.match(ts.displayPartsToString(after.displayParts), /const k: /)
  const vssa = ls.getQuickInfoAtPosition(PCB, posOf(src, 'VSSA'))
  assert.equal(vssa.textSpan.start, posOf(src, 'VSSA'))
  const def = ls.getDefinitionAtPosition(PCB, posOf(src, 'U1.VSSA'))
  assert.deepEqual(def.map(d => d.fileName), [SCH])
  const later = ls.getQuickInfoAtPosition(PCB, posOf(src, 'U1 at'))
  assert.equal(later.textSpan.start, posOf(src, 'U1 at'))
  const sel = ls.getSmartSelectionRange(PCB, k)
  for (let r = sel; r; r = r.parent) assert.ok(r.textSpan.start + r.textSpan.length <= src.length)
  const tokens = ls.getEncodedSemanticClassifications(PCB, { start: 0, length: src.length }, ts.SemanticClassificationFormat.TwentyTwenty)
  for (let i = 0; i < tokens.spans.length; i += 3) {
    const word = src.slice(tokens.spans[i], tokens.spans[i] + tokens.spans[i + 1])
    assert.match(word, /^[A-Za-z_$][\w$]*$/, word)
  }
})

test('ts-plugin: references and rename reach the export and every use', () => {
  const { ls, text } = service()
  const src = text(PCB)
  const at = posOf(src, 'U1.VSSA')
  const refs = ls.getReferencesAtPosition(PCB, at)
  const where = refs.map(r => `${r.fileName === SCH ? 'sch' : 'pcb'}:${(r.fileName === SCH ? text(SCH) : src).slice(r.textSpan.start, r.textSpan.start + r.textSpan.length)}`)
  assert.ok(where.includes('sch:U1'), where.join())
  assert.equal(where.filter(w => w === 'pcb:U1').length, 3, where.join())
  const locs = ls.findRenameLocations(PCB, at, false, false, { providePrefixAndSuffixTextForRename: true })
  assert.equal(locs.filter(l => l.fileName === PCB).length, 3)
  assert.equal(locs.filter(l => l.fileName === SCH).length, 1)
  for (const l of locs.filter(l => l.fileName === PCB)) assert.equal(src.slice(l.textSpan.start, l.textSpan.start + 2), 'U1')
})

test('ts-plugin: an edit to the schematic module injects again', () => {
  const src = readFileSync(PCB, 'utf8').replace('<U1 at="10 10" />', '<U1 at="10 10" />\n    {String(U2)}')
  const { ls, edit } = service({ 'pcb.tsx': src })
  assert.deepEqual(errors(ls).map(message), ['U2 is not exported by ./board.sch'])
  edit(SCH, readFileSync(SCH, 'utf8') + 'export const U2 = MCU(\'x\').connect(VCC, GND, SIG)\n')
  assert.deepEqual(errors(ls).map(message), [])
})
