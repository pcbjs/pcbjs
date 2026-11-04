import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

for (const location of ['config', 'PCB']) {
  test(`${location} plugin keys and cache policy apply across CLI restarts`, { timeout: 120000 }, () => {
    const root = mkdtempSync(join(tmpdir(), 'pcbjs-plugin-startup-'))
    try {
      mkdirSync(join(root, 'node_modules'))
      symlinkSync(resolve(repo, 'node_modules/@pcbjs'), join(root, 'node_modules/@pcbjs'), 'dir')
      const plugin = `import {appendFileSync} from 'node:fs'
const max=Number(process.env.REVIEW_MAX)
const plugin={name:'limit',version:'1',cacheKey:JSON.stringify({max}),cache:process.env.REVIEW_CACHE !== 'false',checks:[{rule:'limit.width',reads:['outline'],run:b=>{appendFileSync('calls','x');return b.bbox.w>max?[{rule:'limit.width',severity:'warning',at:[0,0],message:'width exceeds '+max}]:[]}}]}`
      writeFileSync(
        join(root, 'pcb.config.ts'),
        `import {defineConfig} from '@pcbjs/core'\n${location === 'config' ? plugin : ''}\nexport default defineConfig({entries:['pcb.tsx']${location === 'config' ? ',plugins:process.env.REVIEW_DISABLED ? [] : [plugin]' : ''}})`,
      )
      writeFileSync(
        join(root, 'pcb.tsx'),
        `import PCB from '@pcbjs/core'\n${location === 'PCB' ? plugin : ''}\nexport default <PCB name="Cache" ${location === 'PCB' ? 'plugins={process.env.REVIEW_DISABLED ? [] : [plugin]}' : ''}><rect layer="Edge.Cuts" x={0} y={0} w={30} h={20}/></PCB>`,
      )
      const run = (max, env = {}, ...args) =>
        execFileSync(process.execPath, [resolve(repo, 'packages/pcbjs/bin/pcbjs.js'), 'check', '--cache', ...args], {
          cwd: root,
          env: { ...process.env, NODE_ENV: 'production', REVIEW_MAX: String(max), ...env },
          encoding: 'utf8',
          timeout: 30000,
        })
      assert.doesNotMatch(run(80, { REVIEW_DISABLED: '1' }), /width exceeds/)
      assert.doesNotMatch(run(80), /width exceeds/)
      const warm = run(20)
      assert.match(warm, /width exceeds 20/)
      assert.match(run(20), /cache\s+limit\/limit.width\s+hit/)
      const calls = readFileSync(join(root, 'calls'), 'utf8').length
      const uncached = run(20, { REVIEW_CACHE: 'false' })
      assert.match(uncached, /width exceeds 20/)
      assert.equal(readFileSync(join(root, 'calls'), 'utf8').length, calls + 1)
      run(20, { REVIEW_CACHE: 'false' })
      assert.equal(readFileSync(join(root, 'calls'), 'utf8').length, calls + 2, 'cache:false executes on every startup')
      assert.match(run(20, {}, '--fresh'), /width exceeds 20/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
