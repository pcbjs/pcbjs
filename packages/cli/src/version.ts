import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliVersion, installedPackages, packagesInUse } from './doctor.js'

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `pcbjs 0.1.0: @pcbjs/cli 0.1.0, @pcbjs/core 0.1.0, …`, from the project in `root`, else from where this CLI is installed. */
export function versionLine(root = process.cwd()): string {
  const inProject = packagesInUse(root).filter(p => p.name.startsWith('@pcbjs/'))
  const pkgs = inProject.length ? inProject : installedPackages(cliDir)
  const meta = pkgs.find(p => p.name === '@pcbjs/pcbjs')?.version ?? cliVersion()
  const rest = pkgs.filter(p => p.name !== '@pcbjs/pcbjs').map(p => `${p.name} ${p.version}`)
  return `pcbjs ${meta}${rest.length ? `: ${rest.join(', ')}` : ''}`
}
