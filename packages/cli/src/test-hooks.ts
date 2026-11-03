// The module hooks of test-register.ts: .ts, .mts and .tsx through esbuild as ES modules, and @pcbjs/cli/* found beside this file when the project
// does not hoist it. Synchronous for module.registerHooks, with async forms for module.register where Node has no registerHooks.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

interface Resolved {
  url: string
  format?: string | null
  shortCircuit?: boolean
}
interface Loaded {
  format?: string | null
  source?: string | ArrayBuffer | Uint8Array
  shortCircuit?: boolean
}
type Ctx = { parentURL?: string }

const TS = /\.(m?ts|tsx)$/
const OWN = '@pcbjs/cli/'

/** What to try when the default resolution fails: our own module, else the specifier with a TypeScript extension, as tsc allows. */
function fallbacks(spec: string): string[] {
  if (spec.startsWith(OWN)) return [new URL(`./${spec.slice(OWN.length)}.js`, import.meta.url).href]
  if (/^\.{1,2}\//.test(spec) && !/\.[cm]?[jt]sx?$/.test(spec)) return [`${spec}.ts`, `${spec}.tsx`]
  return []
}

const isTs = (url: string) => url.startsWith('file:') && TS.test(new URL(url).pathname)

function strip(url: string): Loaded {
  const file = fileURLToPath(url)
  const { code } = transformSync(readFileSync(file, 'utf8'), {
    loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
    format: 'esm',
    sourcefile: file,
    sourcemap: 'inline',
    jsx: 'automatic',
    jsxImportSource: '@pcbjs/core',
    target: 'node22',
  })
  return { format: 'module', source: code, shortCircuit: true }
}

export function resolveSync(spec: string, ctx: Ctx, next: (s: string, c: Ctx) => Resolved): Resolved {
  try {
    return next(spec, ctx)
  } catch (e) {
    for (const f of fallbacks(spec))
      try {
        return next(f, ctx)
      } catch {}
    throw e
  }
}

export const loadSync = (url: string, ctx: unknown, next: (u: string, c: unknown) => Loaded): Loaded => (isTs(url) ? strip(url) : next(url, ctx))

export async function resolve(spec: string, ctx: Ctx, next: (s: string, c: Ctx) => Promise<Resolved>): Promise<Resolved> {
  try {
    return await next(spec, ctx)
  } catch (e) {
    for (const f of fallbacks(spec))
      try {
        return await next(f, ctx)
      } catch {}
    throw e
  }
}

export const load = async (url: string, ctx: unknown, next: (u: string, c: unknown) => Promise<Loaded>): Promise<Loaded> => (isTs(url) ? strip(url) : next(url, ctx))
