// node model-child.js <hash> <file> <cache dir>, from modelBoxLoader: writes <cache dir>/<hash>.bin as meshFor does, or exits 1 with the reason.
import { readFileSync } from 'node:fs'
import { meshKey } from '@pcbjs/step/internal/key'
import { readMesh, writeMesh } from './project/mesh-cache.js'

const [hash, path, dir] = process.argv.slice(2)
try {
  if (!readMesh(hash, dir)) {
    const content = new Uint8Array(readFileSync(path))
    if (meshKey(content) !== hash) throw new Error(`${path} changed since the board compiled`)
    const { modelToMesh, meshToBinary } = await import('@pcbjs/step')
    writeMesh(hash, path, dir, meshToBinary(await modelToMesh(content, { path })))
  }
  process.exit(0)
} catch (e: any) {
  process.stderr.write(String(e?.message ?? e).split('\n')[0] + '\n')
  process.exit(1)
}
