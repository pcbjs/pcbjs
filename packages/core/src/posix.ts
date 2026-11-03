// POSIX path functions against a working directory the caller gives, for a platform without node:path.

export interface PathApi {
  sep: string
  delimiter: string
  isAbsolute(p: string): boolean
  resolve(...parts: string[]): string
  join(...parts: string[]): string
  dirname(p: string): string
  basename(p: string, ext?: string): string
  extname(p: string): string
  relative(from: string, to: string): string
}

/** The path with `.`, `..` and repeated slashes applied; `..` above an absolute root is dropped. */
function normal(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const s of p.split('/')) {
    if (!s || s === '.') continue
    if (s !== '..') out.push(s)
    else if (out.length && out[out.length - 1] !== '..') out.pop()
    else if (!abs) out.push('..')
  }
  const body = out.join('/')
  return abs ? `/${body}` : body || '.'
}

export function posixPath(cwd: () => string): PathApi {
  const isAbsolute = (p: string) => p.startsWith('/')
  const resolve = (...parts: string[]) => {
    let p = ''
    for (let i = parts.length - 1; i >= 0 && !isAbsolute(p); i--) if (parts[i]) p = p ? `${parts[i]}/${p}` : parts[i]
    return normal(isAbsolute(p) ? p : `${cwd()}/${p}`)
  }
  const dirname = (p: string) => {
    const t = p.replace(/\/+$/, '')
    if (!t) return p ? '/' : '.'
    const i = t.lastIndexOf('/')
    return i < 0 ? '.' : i === 0 ? '/' : t.slice(0, i)
  }
  const basename = (p: string, ext?: string) => {
    const b = p.replace(/\/+$/, '').split('/').pop() ?? ''
    return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b
  }
  const extname = (p: string) => {
    const b = basename(p)
    const i = b.lastIndexOf('.')
    return i <= 0 ? '' : b.slice(i)
  }
  const relative = (from: string, to: string) => {
    const a = resolve(from).split('/').filter(Boolean),
      b = resolve(to).split('/').filter(Boolean)
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
  }
  const join = (...parts: string[]) => {
    const p = parts.filter(Boolean).join('/')
    return p ? normal(p) + (p.endsWith('/') && normal(p) !== '/' ? '/' : '') : '.'
  }
  return { sep: '/', delimiter: ':', isAbsolute, resolve, join, dirname, basename, extname, relative }
}
