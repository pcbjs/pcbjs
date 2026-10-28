import { execFileSync } from 'node:child_process'
import type { RepoLink } from '@pcbjs/export/site-data'
import type { RepoOption } from '@pcbjs/core/config'

/** Runs git in `cwd` and returns its trimmed output, null when git fails or is missing. */
export type GitRunner = (args: string[], cwd: string) => string | null

export const runGit: GitRunner = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim()
  } catch {
    return null
  }
}

/** An https base URL from what people paste: scp-style ssh, ssh://, a trailing .git or slash, a GitLab /-/ page. */
export function normalizeRepoUrl(raw: string): string {
  let u = raw.trim()
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(u)
  if (scp) u = `https://${scp[1]}/${scp[2]}`
  u = u.replace(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\//, 'https://$1/').replace(/^git\+/, '')
  const dash = u.indexOf('/-/')
  if (dash > 0) u = u.slice(0, dash)
  return u.replace(/\/+$/, '').replace(/\.git$/, '')
}

/** The host flavour, which decides the URL pattern the viewer builds. */
export function repoKind(url: string): RepoLink['kind'] {
  let host = '',
    path = ''
  try {
    const p = new URL(url)
    host = p.hostname.toLowerCase()
    path = p.pathname
  } catch {
    return 'generic'
  }
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github'
  if (host === 'gitlab.com' || host.startsWith('gitlab.') || path.includes('/-/')) return 'gitlab'
  if (host.includes('gitea') || host === 'codeberg.org') return 'gitea'
  if (host === 'bitbucket.org') return 'bitbucket'
  return 'generic'
}

/** '' or a path ending in '/', without a leading './' or '/'. */
const normDir = (d: string) => {
  const t = d
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  return t && t !== '.' ? t + '/' : ''
}

/** The `repo` option resolved: ref from the option, branch, sha or 'main'; dir from the option or the root's path in the work tree. */
export function resolveRepo(opt: RepoOption | undefined, root: string, git: GitRunner = runGit): RepoLink | undefined {
  if (!opt) return undefined
  const o = typeof opt === 'string' ? { url: opt } : opt
  if (!o.url) return undefined
  const url = normalizeRepoUrl(o.url)
  const kind = o.kind ?? (o.url.includes('/-/') ? 'gitlab' : repoKind(url))
  let ref = o.ref
  if (!ref) {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root)
    ref = branch && branch !== 'HEAD' ? branch : git(['rev-parse', 'HEAD'], root) || 'main'
  }
  const dir = o.dir !== undefined ? normDir(o.dir) : normDir(git(['rev-parse', '--show-prefix'], root) ?? '')
  return { url, kind, ref, dir }
}
