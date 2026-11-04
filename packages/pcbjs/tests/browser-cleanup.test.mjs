import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { stopChrome } from '../../../scripts/browser-equality.mjs'

test('browser cleanup stops a child still writing after its parent exits', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-browser-cleanup-'))
  const pulse = join(dir, 'pulse')
  const child = join(dir, 'child.cjs')
  const parent = join(dir, 'parent.cjs')
  writeFileSync(
    child,
    `
    const fs = require('node:fs')
    process.on('SIGTERM', () => {})
    let n = 0
    setInterval(() => fs.writeFileSync(process.argv[2], String(++n)), 5)
    process.send('ready')
  `,
  )
  writeFileSync(
    parent,
    `
    const { fork } = require('node:child_process')
    const child = fork(process.argv[2], [process.argv[3]], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    child.once('message', () => process.send('ready'))
    process.on('SIGTERM', () => process.exit(0))
  `,
  )
  const proc = spawn(process.execPath, [parent, child, pulse], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  try {
    await once(proc, 'message')
    await delay(30)
    await stopChrome(proc)
    await delay(30)
    const stopped = readFileSync(pulse, 'utf8')
    await delay(60)
    assert.equal(readFileSync(pulse, 'utf8'), stopped)
  } finally {
    await stopChrome(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})
