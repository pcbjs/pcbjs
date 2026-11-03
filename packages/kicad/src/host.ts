// The files, paths and environment KiCad libraries are read through: the platform of @pcbjs/core, Node's or a browser compile's.
import { platform } from '@pcbjs/core/platform'

export const exists = (f: string): boolean => platform().exists(f)
export const isDir = (f: string): boolean => !!platform().stat(f)?.dir
export const env = (name: string): string | undefined => platform().env(name)
export const home = (): string => platform().home()
export const sha1 = (text: string): string => platform().sha1(text)
/** Windows paths and `;` lists */
export const windows = (): boolean => platform().path.sep === '\\'

/** UTF-8 text; throws naming the file when it cannot be read, as fs.readFileSync does. */
export function readText(f: string): string {
  const t = platform().text(f)
  if (t === null) throw new Error(`ENOENT: no such file or directory, open '${f}'`)
  return t
}

/** The names in a folder; throws when it is not one, as fs.readdirSync does. */
export function readDir(d: string): string[] {
  const l = platform().list(d)
  if (!l) throw new Error(`ENOENT: no such file or directory, scandir '${d}'`)
  return l
}

export const join = (...p: string[]): string => platform().path.join(...p)
export const resolve = (...p: string[]): string => platform().path.resolve(...p)
export const relative = (from: string, to: string): string => platform().path.relative(from, to)
export const isAbsolute = (p: string): boolean => platform().path.isAbsolute(p)
export const dirname = (p: string): string => platform().path.dirname(p)
export const basename = (p: string, ext?: string): string => platform().path.basename(p, ext)
