// pcbjs: New project from an example: a pick of the examples `pcbjs create --list-examples` prints, a folder, then `pcbjs create --example`.

import * as vscode from 'vscode'
import { defaultProjectDir, pcbjsRunner, pickFolder, projectDirError, projectPrompt, roots, run, scaffold, type SetupHost } from './setup'

export interface Example {
  name: string
  description: string
}

/** The lines of `pcbjs create --list-examples`: a name, two or more spaces, its description. */
export function parseExamples(lines: string[]): Example[] {
  return lines.flatMap(l => {
    const m = /^(\S+)\s{2,}(.+)$/.exec(l.trim())
    return m ? [{ name: m[1], description: m[2] }] : []
  })
}

async function listExamples(h: SetupHost): Promise<Example[] | undefined> {
  const pcbjs = pcbjsRunner(roots(), h.nodePath(), h.env)
  const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'pcbjs: listing the examples' }, () =>
    run(pcbjs, ['create', '--list-examples'], roots()[0] ?? process.cwd(), h),
  )
  const found = res.code === 0 ? parseExamples(res.lines) : []
  if (found.length) return found
  void vscode.window.showErrorMessage('pcbjs: no examples listed; the pcbjs that ran may predate them.', 'Show output').then(a => a && h.showOutput())
  return undefined
}

export async function newFromExample(h: SetupHost): Promise<string | undefined> {
  const all = await listExamples(h)
  if (!all) return undefined
  const picked = await vscode.window.showQuickPick(
    all.map(e => ({ label: e.name, detail: e.description, example: e })),
    { title: 'pcbjs: New project from an example', placeHolder: 'Start from which example board?', matchOnDetail: true },
  )
  if (!picked) return undefined
  const parent = await pickFolder('Create the project in which folder?', 'Create here')
  if (!parent) return undefined
  const name = await vscode.window.showInputBox({
    title: `pcbjs: New project from the ${picked.label} example`,
    prompt: projectPrompt(parent),
    value: defaultProjectDir(parent, picked.label),
    validateInput: v => projectDirError(parent, v),
  })
  if (name === undefined) return undefined
  return scaffold(h, parent, name.trim(), ['--example', picked.label])
}
