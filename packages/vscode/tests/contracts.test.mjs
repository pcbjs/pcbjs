import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../../..')
const read = p => readFileSync(resolve(root, p), 'utf8')
const catalog = JSON.parse(read('scripts/vscode-contracts.json'))
const manifest = JSON.parse(read('packages/vscode/package.json')).contributes

test('every contributed editor command, menu action and key has a behavior family, source and acceptance evidence', () => {
  assert.equal(catalog.operations.length, 52)
  assert.equal(new Set(catalog.operations.map(o => o.id)).size, 52)
  const registered = new Set(catalog.operations.flatMap(o => o.commands))
  const commands = manifest.commands.map(c => c.command)
  assert.deepEqual([...registered].sort(), [...commands].sort(), 'new commands require a behavior row')
  for (const menu of Object.values(manifest.menus)) for (const item of menu) {
    assert.ok(registered.has(item.command), item.command)
    if (item.alt) assert.ok(registered.has(item.alt), item.alt)
  }
  for (const key of manifest.keybindings) assert.ok(registered.has(key.command), key.command)
  for (const welcome of manifest.viewsWelcome) for (const match of welcome.contents.matchAll(/command:(pcbjs\.[\w.]+)/g)) assert.ok(registered.has(match[1]), match[1])
  for (const operation of catalog.operations) {
    for (const field of ['preconditions', 'result', 'writes', 'cancelUndo', 'unavailable', 'support', 'coverage', 'missingAcceptance']) assert.ok(operation[field], `${operation.id} ${field}`)
    for (const p of [...operation.sources, ...operation.tests]) assert.ok(existsSync(resolve(root, p)), `${operation.id}: ${p}`)
  }
})

test('dynamic lens payload command IDs and producers match the explicit informational-lens contract', () => {
  const spec = catalog.dynamicLenses
  const source = ts.createSourceFile(spec.source, read(spec.source), ts.ScriptTarget.Latest, true)
  const commands = new Set()
  const families = new Set()
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'codeLenses') {
      function calls(child) {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) families.add(child.expression.text)
        ts.forEachChild(child, calls)
      }
      calls(node)
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'command' && ts.isStringLiteral(node.initializer)) commands.add(node.initializer.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.deepEqual([...commands].sort(), spec.commandIds.slice().sort(), 'a new executable lens needs a catalog entry and acceptance')
  assert.deepEqual([...families].sort(), spec.families.slice().sort())
})
