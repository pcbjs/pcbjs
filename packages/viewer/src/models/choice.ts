// apart from three.js so the rule can be tested in Node
import type { ModelSpec } from '@pcbjs/core/types'

/** Its own model, none for `none`, else a box when it has a height; a bare hole comes with height 0. */
export function modelChoice(fp: { model?: ModelSpec; body: { w: number; h: number }; height: number }): ModelSpec | null {
  if (fp.model?.kind === 'none') return null
  if (fp.model) return fp.model
  return fp.height > 0 ? { kind: 'box', w: fp.body.w, h: fp.body.h, height: fp.height } : null
}
