/** File identity across editor, Vite and TypeScript paths; POSIX spelling stays significant. */
export const fileKey = (file: string): string => (process.platform === 'win32' ? file.replace(/\\/g, '/').toLowerCase() : file)

export const sameFile = (a: string, b: string): boolean => fileKey(a) === fileKey(b)

export function under(file: string, dir: string): boolean {
  const f = fileKey(file),
    d = fileKey(dir)
  return f === d || f.startsWith(d.endsWith('/') ? d : d + '/')
}
