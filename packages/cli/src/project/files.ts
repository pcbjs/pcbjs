import { posix, win32 } from 'node:path'

/** File identity across editor, Vite and TypeScript paths; POSIX spelling stays significant. */
export const fileKey = (file: string): string => (process.platform === 'win32' ? file.replace(/\\/g, '/').toLowerCase() : file)

export const sameFile = (a: string, b: string): boolean => fileKey(a) === fileKey(b)

export function under(file: string, dir: string): boolean {
  const f = fileKey(file),
    d = fileKey(dir)
  return f === d || f.startsWith(d.endsWith('/') ? d : d + '/')
}

/** Project-local source names use portable separators; outside files stay absolute. */
export function sourcePath(root: string, file: string): string {
  const path = process.platform === 'win32' ? win32 : posix
  return under(file, root) ? path.relative(root, file).split(path.sep).join('/') : file
}
