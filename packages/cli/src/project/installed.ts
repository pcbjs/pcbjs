// The @pcbjs packages a project resolves; no other CLI module, so the compile thread and the report can read it.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface InstalledPackage {
  name: string
  version: string
  dir: string
}

/** Every @pcbjs package a project resolves, nearest node_modules first, as Node resolves them. */
export function installedPackages(root: string): InstalledPackage[] {
  const found = new Map<string, InstalledPackage>()
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const scope = join(dir, 'node_modules', '@pcbjs')
    if (existsSync(scope))
      for (const sub of readdirSync(scope).sort()) {
        const name = `@pcbjs/${sub}`
        const pkgFile = join(scope, sub, 'package.json')
        if (found.has(name) || !existsSync(pkgFile)) continue
        try {
          found.set(name, { name, version: JSON.parse(readFileSync(pkgFile, 'utf8')).version, dir: join(scope, sub) })
        } catch {}
      }
    if (dirname(dir) === dir) break
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}
