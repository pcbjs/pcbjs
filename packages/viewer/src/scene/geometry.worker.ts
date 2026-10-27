import { resultBuffers, runJob, type GeoJob, type GeoResult } from './geometry'

self.onmessage = (e: MessageEvent<{ id: number; jobs: GeoJob[] }>) => {
  const t0 = performance.now()
  const results: GeoResult[] = e.data.jobs.map(runJob)
  ;(self as unknown as Worker).postMessage({ id: e.data.id, results, ms: performance.now() - t0 }, results.flatMap(resultBuffers))
}
