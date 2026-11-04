// Loaded by every package's test script: a test file still running after PCBJS_TEST_FILE_MS, default 10 minutes, fails and stops the children it spawned.
import cp from 'node:child_process'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { syncBuiltinESMExports } from 'node:module'

// Windows TEMP may use an 8.3 alias; fixtures and Vite must agree on the directory.
if (process.platform === 'win32') {
  const directory = realpathSync.native(tmpdir())
  process.env.TEMP = directory
  process.env.TMP = directory
}

if (process.env.NODE_TEST_CONTEXT) {
  const kids = new Set()
  for (const name of ['spawn', 'fork', 'execFile', 'exec']) {
    const fn = cp[name]
    cp[name] = function (...args) {
      const child = fn.apply(this, args)
      kids.add(child)
      child.once('exit', () => kids.delete(child))
      return child
    }
  }
  syncBuiltinESMExports()
  const ms = Number(process.env.PCBJS_TEST_FILE_MS ?? 600000)
  const timer = setTimeout(() => {
    console.error(`${process.argv[1]}: still running after ${ms} ms, stopped with ${kids.size} children`)
    for (const child of kids) child.kill('SIGKILL')
    process.exit(1)
  }, ms)
  timer.unref()
}
