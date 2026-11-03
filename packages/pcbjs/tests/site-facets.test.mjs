// The facet table on whole boards: each board's data split into its facets and joined again is the same data, and every
// facet holds only its own keys, on the four demo boards and usb3-hub.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FACET_NAMES, FACETS, joinSite, splitSite } from '@pcbjs/core/site-facets'

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples')

async function sites(example) {
  const { resolveConfig } = await import('@pcbjs/cli/internal/config')
  const { pluginState } = await import('@pcbjs/cli/internal/site')
  const { compileServer, compileSlots } = await import('@pcbjs/cli/internal/compile')
  const { viteLoader } = await import('@pcbjs/cli/internal/loader')
  const { DATA_FORMATS } = await import('@pcbjs/cli/internal/project')
  const cfg = await resolveConfig([], 'build', undefined, join(EXAMPLES, example))
  const state = pluginState(cfg)
  const server = await compileServer(cfg)
  try {
    await compileSlots(viteLoader(server), cfg, state.slots, new Map(), { formats: DATA_FORMATS })
  } finally {
    await server.close()
  }
  return state.slots.flatMap(s => s.compiled ?? []).map(c => c.site)
}

for (const example of ['demo', 'usb3-hub'])
  test(`joinSite(splitSite(site)) is the site on ${example}`, { timeout: 300000 }, async () => {
    const all = await sites(example)
    assert.ok(all.length >= (example === 'demo' ? 4 : 1))
    for (const site of all) {
      const parts = splitSite(site)
      assert.deepEqual(joinSite(parts), site, site.name)
      for (const f of FACET_NAMES) for (const k of Object.keys(parts[f])) assert.ok(k in FACETS[f].keys, `${site.name}: ${k} in ${f}`)
    }
  })
