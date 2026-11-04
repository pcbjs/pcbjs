// The models a dev server and a built site serve: GET /__pcbjs/model/<hash> in dev, models/<hash>.bin in a build.
import type { Connect, Plugin } from 'vite'
import type { ResolvedConfig } from '../project/config.js'
import type { BoardOut } from '../project/project.js'
import { isMeshHash, meshFor, modelsDir, usedModels } from '../project/models.js'
import { referenceMesh, usedReferenceMeshes } from '../project/references.js'
import type { PluginState } from './site.js'

/** The isolated preview of dev included. */
export function compiledOf<T extends BoardOut>(state: { slots: { compiled?: T[] | null }[]; preview?: { compiled: T } | null }): T[] {
  return [...state.slots.flatMap(s => s.compiled ?? []), ...(state.preview ? [state.preview.compiled] : [])]
}

/** GET /__pcbjs/model/<hash> answers with the mesh binary of a model a compiled board uses. */
export function modelMiddleware(projects: () => Iterable<{ root: string; compiled: Iterable<Pick<BoardOut, 'board' | 'site'>> }>): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/__pcbjs/model/')) return next()
    const hash = url.slice('/__pcbjs/model/'.length)
    const model = isMeshHash(hash) ? [...projects()].map(p => ({ root: p.root, path: usedModels(p.compiled).get(hash) })).find(p => p.path) : undefined
    if (!model?.path) {
      res.statusCode = 404
      res.end('no such model')
      return
    }
    meshFor(hash, model.path, modelsDir(model.root)).then(
      bin => {
        res.setHeader('content-type', 'application/octet-stream')
        // the hash names the content, so the browser may keep it
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        res.end(Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength))
      },
      (e: any) => {
        console.warn(`[pcbjs] model ${model.path}: ${String(e?.message ?? e)}`)
        res.statusCode = 500
        res.end(String(e?.message ?? e))
      },
    )
  }
}

/** Model assets of a built site; the session serves its runtimes' models. */
export function modelsPlugin(cfg: ResolvedConfig, state: PluginState, mode: 'dev' | 'build'): Plugin {
  return {
    name: 'pcbjs:models',
    async generateBundle() {
      // the SSR bundle of the prerender never loads a mesh
      if (mode !== 'build' || (this.environment && this.environment.name !== 'client')) return
      for (const [hash, path] of usedModels(compiledOf(state))) {
        try {
          this.emitFile({ type: 'asset', fileName: `models/${hash}.bin`, source: await meshFor(hash, path, modelsDir(cfg.root)) })
        } catch (e: any) {
          this.warn(`model ${path}: ${String(e?.message ?? e)}; the site draws the generated model`)
        }
      }
      // referenced boards, as models/boards/<hash>.bin
      for (const hash of usedReferenceMeshes(compiledOf(state))) {
        const bin = referenceMesh(hash)
        if (bin) this.emitFile({ type: 'asset', fileName: `models/boards/${hash}.bin`, source: bin })
        else this.warn(`reference mesh ${hash} is not in the cache`)
      }
    },
  }
}
