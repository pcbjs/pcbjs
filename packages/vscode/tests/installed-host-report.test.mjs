import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { setImmediate } from 'node:timers/promises'
import { writeJson } from './installed-host/report.cjs'

test('installed-host reports remain complete during concurrent reads', { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-host-report-'))
  const file = join(dir, 'report.json')
  writeJson(file, { generation: 0, checks: [0] })
  const worker = new Worker(
    `
    const { workerData } = require('node:worker_threads')
    const { writeJson } = require(workerData.helper)
    for (let generation = 1; generation <= 100; generation++) {
      writeJson(workerData.file, { generation, checks: Array(10000).fill(generation) })
    }
  `,
    { eval: true, workerData: { file, helper: fileURLToPath(new URL('./installed-host/report.cjs', import.meta.url)) } },
  )
  let done = false
  const finished = new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('exit', code => {
      done = true
      code === 0 ? resolve() : reject(new Error(`writer exited ${code}`))
    })
  })
  try {
    let reads = 0
    while (!done) {
      const report = JSON.parse(readFileSync(file, 'utf8'))
      assert.ok(report.checks.every(value => value === report.generation))
      reads++
      await setImmediate()
    }
    await finished
    assert.ok(reads > 1)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).generation, 100)
  } finally {
    await worker.terminate()
    rmSync(dir, { recursive: true, force: true })
  }
})
