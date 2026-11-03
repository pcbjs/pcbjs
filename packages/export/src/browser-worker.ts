// The browser compile worker, a module Web Worker: `new Worker(new URL('@pcbjs/export/browser-worker', import.meta.url), { type: 'module' })`.
import { serveCompile, type WorkerPort } from '@pcbjs/compile/browser'
import { facetStream } from './facet-stream.js'

serveCompile(globalThis as unknown as WorkerPort, { stream: facetStream })
