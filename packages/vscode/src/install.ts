// The install flow: the version the dist-tags resolve to, a checkbox that takes beta and next in, and `npm install -D` in a terminal.

import * as vscode from 'vscode'
import { CORE, TAGS, distTags, installCommand, installDir, prereleaseDefault, resolveInstall, type FetchFn, type Resolution } from './version'

export interface InstallHost {
  /** the train version the extension was packaged against, the offline fallback */
  packaged: string
  fetch?: FetchFn
}

type Item = vscode.QuickPickItem & { go?: boolean; toggle?: boolean }

/** One pick until the version is chosen: the version line, then the checkbox, which flips and asks again. */
export async function pickVersion(h: InstallHost, title: string, verb: string): Promise<Resolution | undefined> {
  const tags = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `pcbjs: reading the ${CORE} dist-tags` }, () => distTags(h.fetch))
  let pre = prereleaseDefault(h.packaged)
  for (;;) {
    const r = resolveInstall(tags, pre, h.packaged)
    const known = tags ? TAGS.map(t => `${t} ${tags[t] ?? 'none'}`).join(', ') : 'the registry did not answer'
    const items: Item[] = [
      {
        label: `$(cloud-download) ${verb} ${CORE} ${r.version}`,
        description: installCommand(r),
        detail: r.offline ? `offline: ${r.version} is the version this extension was packaged against` : `the ${r.tag} dist-tag`,
        go: true,
      },
      { label: `${pre ? '$(pass-filled)' : '$(circle-large-outline)'} Include the beta and next dist-tags`, detail: known, toggle: true },
    ]
    const qp = vscode.window.createQuickPick<Item>()
    Object.assign(qp, { title, placeholder: `${verb} which version of ${CORE}?`, items, ignoreFocusOut: true })
    qp.activeItems = [items[0]]
    const chosen = await new Promise<Item | undefined>(done => {
      qp.onDidAccept(() => {
        done(qp.selectedItems[0] ?? qp.activeItems[0])
        qp.hide()
      })
      qp.onDidHide(() => {
        done(undefined)
        qp.dispose()
      })
      qp.show()
    })
    if (!chosen) return undefined
    if (chosen.go) return r
    pre = !pre
  }
}

/** `npm install -D @pcbjs/pcbjs@<tag>` in a terminal, in the project of the file or the root. */
export async function installFlow(h: InstallHost, root: string, file?: string): Promise<Resolution | undefined> {
  const r = await pickVersion(h, 'pcbjs: Install pcbjs', 'Install')
  if (!r) return undefined
  const terminal = vscode.window.createTerminal({ name: 'pcbjs install', cwd: installDir(root, file) })
  terminal.show()
  terminal.sendText(installCommand(r))
  return r
}
