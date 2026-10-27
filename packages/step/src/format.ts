/** A model file format: STEP, glTF as JSON or binary, or VRML 2 as KiCad's packages3D library ships it. */
export type ModelFormat = 'step' | 'gltf' | 'glb' | 'wrl'

export const MODEL_EXTENSIONS: Record<ModelFormat, string[]> = { step: ['.step', '.stp'], gltf: ['.gltf'], glb: ['.glb'], wrl: ['.wrl', '.vrml'] }

export function formatOfName(name: string): ModelFormat | null {
  const m = /\.[a-z0-9]+$/i.exec(name.split(/[?#]/)[0])
  if (!m) return null
  const ext = m[0].toLowerCase()
  for (const [f, exts] of Object.entries(MODEL_EXTENSIONS)) if (exts.includes(ext)) return f as ModelFormat
  return null
}

const text = (b: Uint8Array, n: number) => String.fromCharCode(...b.subarray(0, Math.min(n, b.length)))

/** The format by the first bytes; a gzipped file is VRML, as `.wrz` is. */
export function formatOfContent(b: Uint8Array): ModelFormat | null {
  if (b.length >= 4 && text(b, 4) === 'glTF') return 'glb'
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return 'wrl'
  const head = text(b, 256).replace(/^﻿/, '').trimStart()
  if (head.startsWith('ISO-10303-21')) return 'step'
  if (head.startsWith('#VRML')) return 'wrl'
  if (head.startsWith('{') && /"asset"|"meshes"|"accessors"/.test(text(b, 4096))) return 'gltf'
  return null
}

export function modelFormat(name: string | undefined, content?: Uint8Array): ModelFormat | null {
  return (name ? formatOfName(name) : null) ?? (content ? formatOfContent(content) : null)
}
