// What one compile of a project costs the session's main thread: the main thread's active time while the compile thread answers, the
// snapshot commit and the facet reconcile after it, and the bytes the answers carry, for a warm compile whose stages all hit and for the
// first answer of a fresh thread, which carries everything. Run alone as `node worker-boundary.mjs <project> [entry]`; the test asserts the budgets.
import { performance } from 'node:perf_hooks'
import { serialize } from 'node:v8'
import { Worker } from 'node:worker_threads'
import { join, resolve } from 'node:path'
import { workerCompiler } from '../dist/session/worker-client.js'
import { snapshots } from '../dist/session/snapshots.js'
import { facetStore } from '../dist/session/facet-store.js'

// every message a compile thread posts, measured as it arrives
let bytes = 0
let counting = false
const emit = Worker.prototype.emit
Worker.prototype.emit = function (event, ...args) {
  if (counting && event === 'message') bytes += serialize(args[0]).length
  return emit.call(this, event, ...args)
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** One compile through the session's path: its main-thread ms and the bytes it carried, measured in two passes so counting never adds to the time. */
async function once(c, entry, root, views, counted) {
  counting = counted
  bytes = 0
  const e0 = performance.eventLoopUtilization()
  const out = await c.compile(entry, { draft: false })
  const active = performance.eventLoopUtilization(e0).active
  counting = false
  const t0 = performance.now()
  snapshots('bench').commit({ project: root, slots: [{ entry, compiled: out, error: null, conflict: null }], stamps: new Map(), overlay: new Map(), texts: new Map() })
  const commit = performance.now() - t0
  const t1 = performance.now()
  for (const o of out) for (const f of views.reconcile(o, 1)) views.put(f)
  const reconcile = performance.now() - t1
  return { block: active + commit + reconcile, active, commit, reconcile, bytes }
}

/** The fresh thread's first answer, then `runs` warm all-hit compiles, each timed and counted in passes of their own. */
export async function boundaryBench(root, rel = 'pcb.tsx', runs = 5) {
  const entry = { file: join(root, rel), rel }
  const c = workerCompiler({ root, configFile: join(root, 'pcb.config.ts'), log: () => {} })
  const views = facetStore()
  try {
    const fresh = await once(c, entry, root, views, true)
    const warm = []
    for (let i = 0; i < runs; i++) {
      const timed = await once(c, entry, root, views, false)
      const { bytes } = await once(c, entry, root, views, true)
      warm.push({ ...timed, bytes })
    }
    const round = x => Math.round(x * 10) / 10
    return {
      fresh: { block: round(fresh.block), bytes: fresh.bytes },
      warm: {
        block: round(median(warm.map(w => w.block))),
        active: round(median(warm.map(w => w.active))),
        commit: round(median(warm.map(w => w.commit))),
        reconcile: round(median(warm.map(w => w.reconcile))),
        bytes: median(warm.map(w => w.bytes)),
      },
    }
  } finally {
    await c.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await boundaryBench(resolve(process.argv[2]), process.argv[3])))
