// The preview's frame budgets on usb3-hub, bench.json's `view`: idle, pointer move, hover, wheel zoom, a drag's first response and its
// frames, plain and with the 50 and more findings the drag makes, each the median of its samples, in a headless Chromium through
// view-perf.mjs. A run fails over budget by more than a margin that grows with the machine's load. Skipped without a Chromium;
// PCBJS_VIEW_SHOTS names a folder for the page's screenshots.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { overBudget, viewBench, viewSkip } from './view-perf.mjs'

const REPO = join(import.meta.dirname, '..', '..', '..')
const skip = viewSkip()

test('the view budgets on usb3-hub', { skip, timeout: 900000 }, async () => {
  const { budgets } = JSON.parse(readFileSync(join(REPO, 'bench.json'), 'utf8')).view
  const { out } = await viewBench({ shots: process.env.PCBJS_VIEW_SHOTS })
  assert.ok(out.findingCount >= 50, `the drag made ${out.findingCount} findings, fewer than 50`)
  const over = overBudget(out, budgets)
  assert.deepEqual(over, [], `${over.join('\n')}\n${JSON.stringify(out)}`)
})
