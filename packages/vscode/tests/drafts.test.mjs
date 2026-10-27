// The spans a draft preview skipped reach the editor as faint hints, whatever severity the server sent; other diagnostics pass as they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { draftHint, DRAFT_SOURCE } = require('../dist/drafts.cjs');

// vscode.DiagnosticSeverity.Hint and vscode.DiagnosticTag.Unnecessary
const HINT = 3;
const UNNECESSARY = 1;

test('drafts: a skipped span is a hint with the Unnecessary tag, never an error', () => {
  for (const severity of [0, 1, 2, 3, undefined]) {
    const d = draftHint({ source: DRAFT_SOURCE, severity, message: 'skipped in the preview: a syntax error' }, HINT, UNNECESSARY);
    assert.equal(d.severity, HINT);
    assert.deepEqual(d.tags, [UNNECESSARY]);
  }
  assert.deepEqual(draftHint({ source: DRAFT_SOURCE, severity: HINT, tags: [UNNECESSARY] }, HINT, UNNECESSARY).tags, [UNNECESSARY]);
});

test('drafts: DRC and ERC findings keep their severity', () => {
  const drc = { source: 'pcbjs DRC', severity: 0, code: 'clearance', message: 'too close' };
  assert.deepEqual(draftHint({ ...drc }, HINT, UNNECESSARY), drc);
});
