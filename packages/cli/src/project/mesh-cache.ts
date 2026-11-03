// Mesh files in a project's .pcbjs/models, each a view of the user cache when it can be written.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { store, viewOf } from '@pcbjs/compile/internal/user-cache'
import { CONVERTER_VERSION, fullOptions } from '@pcbjs/step/internal/key'

const meshKeyOf = (hash: string) => `meshes/${hash}.bin`

function readFile(file: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(file))
  } catch {
    return null
  }
}

/** The project's file of a mesh, linked from the user cache when only the cache has it; null when neither has it. */
export function readMesh(hash: string, dir: string): Uint8Array | null {
  const file = join(dir, `${hash}.bin`)
  return readFile(file) ?? (viewOf(meshKeyOf(hash), file) ? readFile(file) : null)
}

/** Written through a temporary file and a rename, so another process never reads half a file, then put into the user cache. */
export function writeMesh(hash: string, source: string, dir: string, bin: Uint8Array): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${hash}.bin`),
    tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    writeFileSync(tmp, bin)
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
  store(meshKeyOf(hash), file, { source, options: { converter: CONVERTER_VERSION, ...fullOptions() } })
}
