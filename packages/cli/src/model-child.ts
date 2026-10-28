// node model-child.js <hash> <file> <cache dir>, from modelBoxLoader: writes <cache dir>/<hash>.bin as meshFor does, or exits 1 with the reason.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { meshKey } from '@pcbjs/step/key'

const [hash, path, dir] = process.argv.slice(2)
try {
  const content = new Uint8Array(readFileSync(path))
  if (meshKey(content) !== hash) throw new Error(`${path} changed since the board compiled`)
  const { modelToMesh, meshToBinary } = await import('@pcbjs/step')
  const bin = meshToBinary(await modelToMesh(content, { path }))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${hash}.bin`),
    tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    writeFileSync(tmp, bin)
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
  process.exit(0)
} catch (e: any) {
  process.stderr.write(String(e?.message ?? e).split('\n')[0] + '\n')
  process.exit(1)
}
