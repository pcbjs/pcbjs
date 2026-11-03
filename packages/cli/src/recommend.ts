// The workspace recommendation of the VS Code extension: `.vscode/extensions.json` and a devcontainer's
// `customizations.vscode.extensions`, the places VS Code and Codespaces read it from. The extension's wizard writes the same.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const EXTENSION_ID = 'pcbjs.vscode-pcbjs'
export const DEVCONTAINERS = ['.devcontainer/devcontainer.json', '.devcontainer.json']

/** JSON with comments and trailing commas as plain JSON, strings kept. */
export function stripJsonc(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      const str = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i))?.[0] ?? text.slice(i)
      out += str
      i += str.length - 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) break
      i = end + 1
    } else out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

type Outcome = 'written' | 'kept' | 'commented' | 'missing'

/** The edit applied to a JSON file, created when missing and `create`; a file with comments is left as it is. */
function editJson(file: string, edit: (json: any) => boolean, create: boolean): Outcome {
  if (!existsSync(file)) {
    if (!create) return 'missing'
    const json = {}
    edit(json)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
    return 'written'
  }
  const text = readFileSync(file, 'utf8')
  const plain = stripJsonc(text)
  let json: any
  try {
    json = JSON.parse(plain)
  } catch {
    return 'commented'
  }
  if (!json || typeof json !== 'object' || !edit(json)) return 'kept'
  if (plain !== text) return 'commented'
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
  return 'written'
}

/** The list with the extension added, null when it holds it already. */
const withId = (list: unknown): string[] | null => {
  const l = Array.isArray(list) ? list : []
  return l.includes(EXTENSION_ID) ? null : [...l, EXTENSION_ID]
}

const report = (rel: string, r: Outcome, key: string): string[] =>
  r === 'written' ? [`recommended ${EXTENSION_ID} in ${rel}`] : r === 'commented' ? [`${rel} has comments, so add "${EXTENSION_ID}" to ${key} by hand`] : []

/** `.vscode/extensions.json` of the folder recommending the extension, created when missing; the line to print. */
export function recommendExtension(dir: string): string[] {
  const r = editJson(
    join(dir, '.vscode', 'extensions.json'),
    j => {
      const next = withId(j.recommendations)
      if (next) j.recommendations = next
      return !!next
    },
    true,
  )
  return report('.vscode/extensions.json', r, 'recommendations')
}

/** The extension in `customizations.vscode.extensions` of each devcontainer the folder has; the lines to print. */
export function recommendInDevcontainers(dir: string): string[] {
  return DEVCONTAINERS.flatMap(rel => {
    const r = editJson(
      join(dir, rel),
      j => {
        const vscode = ((j.customizations ??= {}).vscode ??= {})
        const next = withId(vscode.extensions)
        if (next) vscode.extensions = next
        return !!next
      },
      false,
    )
    return report(rel, r, 'customizations.vscode.extensions')
  })
}

/** The repository root above dir, the folder holding `.git`, or undefined. */
export function repoRoot(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d
    if (dirname(d) === d) return undefined
  }
}
