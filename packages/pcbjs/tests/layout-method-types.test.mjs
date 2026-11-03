import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

test('layout methods infer circuit members and ports in JSX callbacks', () => {
  const file = fileURLToPath(new URL('./fixtures/layout-method.tsx', import.meta.url))
  const program = ts.createProgram([file], {
    strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX, jsxImportSource: '@pcbjs/core',
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
})
