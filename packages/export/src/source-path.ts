import { platform } from '@pcbjs/core/platform'

/** Source names inside the project use portable separators; external files remain absolute. */
export function sourcePath(root: string, file: string): string {
  const path = platform().path
  if (!root || !path.isAbsolute(file)) return file
  const rel = path.relative(root, file)
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file
}
