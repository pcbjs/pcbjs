const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

exports.run = async () => {
  const result = { checks: [], failures: [], tabs: [], extension: null, platform: process.platform, vscode: vscode.version }
  const report = () => fs.writeFileSync(process.env.PCBJS_HOST_REPORT, JSON.stringify(result, null, 2))
  const wait = async (name, fn, ms = 60000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const value = await fn()
      if (value) return value
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error(`Timed out: ${name}`)
  }
  const check = async (name, fn) => {
    try { await fn(); result.checks.push(name) }
    catch (error) { result.failures.push({ name, error: error.stack }); throw error }
    finally { report() }
  }
  const tabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => ({ label: t.label, column: g.viewColumn, type: t.input?.constructor?.name, active: t.isActive && g.isActive })))
  const panes = () => tabs().filter(t => / \| (2D|3D|Schematic)/.test(t.label))
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath
  const source = path.join(root, 'quad.pcb.tsx')
  const doc = await vscode.workspace.openTextDocument(source)
  const sourceChanges = []
  const changes = vscode.workspace.onDidChangeTextDocument(e => {
    if (e.document.uri.toString() === doc.uri.toString()) sourceChanges.push({ version: e.document.version, reason: e.reason, head: e.document.getText().slice(0, 120), changes: e.contentChanges.map(c => ({ range: c.range, text: c.text.slice(0, 120) })) })
  })
  result.sourceChanges = sourceChanges
  const showSource = async () => {
    const editor = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One, preserveFocus: false })
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
    return editor
  }
    const probe = async (kind, files, redo = false, extra = {}) => {
      const id = `${kind}-${Date.now()}`
      result.probe = { id, kind, files, redo, ...extra }
      report()
      const response = await wait(kind + ' webview dispatch', () => {
        if (!fs.existsSync(process.env.PCBJS_HOST_ACK)) return null
        const ack = JSON.parse(fs.readFileSync(process.env.PCBJS_HOST_ACK, 'utf8'))
        return ack.id === id ? ack : null
      })
      if (response.error) throw new Error(response.error)
      return response.evidence
    }
  const devtoolsCheck = async () => {
    await check('installed devtools commands target the active 2D pane without changing source or selection', async () => {
      await vscode.workspace.getConfiguration('pcbjs').update('development', true, vscode.ConfigurationTarget.Global)
      await showSource()
      await vscode.commands.executeCommand('pcbjs.open2D')
      await wait('active 2D preview for devtools', () => panes().some(t => t.active && t.label.includes('2D')))
      const text = doc.getText()
      const before = await probe('devtools-state', [], false, { enabled: false })
      const selections = frames => frames.map(({ id, selection }) => ({ id, selection }))
      assert.equal(await vscode.commands.executeCommand('pcbjs.devtools.enable'), true, 'active preview accepts inspector command')
      const enabled = await probe('devtools-state', [], false, { enabled: true })
      assert.equal(enabled.frames.filter(f => f.inspector).length, 1)
      assert.ok(enabled.frames.filter(f => f.view === '3d').every(f => !f.inspector))
      const focused = enabled.frames.find(f => f.inspector)
      assert.equal(focused.state.view, '2d')
      assert.deepEqual(selections(enabled.frames), selections(before.frames))
      await vscode.commands.executeCommand('pcbjs.devtools.disable')
      const disabled = await probe('devtools-state', [], false, { enabled: false })
      assert.deepEqual(selections(disabled.frames), selections(before.frames))
      await vscode.commands.executeCommand('pcbjs.devtools.toggle')
      const toggled = await probe('devtools-state', [], false, { enabled: true })
      assert.deepEqual(toggled.frames.find(f => f.inspector).state.selection, focused.state.selection)
      await vscode.commands.executeCommand('pcbjs.devtools.disable')
      await probe('devtools-state', [], false, { enabled: false })
      assert.equal(doc.getText(), text)
      result.devtools = { enabled, disabled, toggled }
    })
  }
  try {
    await check('candidate VSIX is installed and activated in the isolated host', async () => {
      const ext = vscode.extensions.getExtension('pcbjs.vscode-pcbjs')
      assert.ok(ext)
      await ext.activate()
      assert.ok(ext.isActive)
      assert.ok(ext.extensionPath.startsWith(process.env.PCBJS_HOST_EXTENSIONS + path.sep))
      result.extension = { path: ext.extensionPath, version: ext.packageJSON.version, train: ext.packageJSON.pcbjs?.train }
    })
    await showSource()
    await check('autoStart discovers and starts the scratch workspace session', async () => {
      await vscode.workspace.getConfiguration('pcbjs').update('autoStart', true, vscode.ConfigurationTarget.Global)
      await wait('scratch session dev.json', () => fs.existsSync(path.join(root, '.pcbjs/dev.json')), 120000)
    })
    await check('open2D creates one pane and repeat reuses it', async () => {
      await vscode.commands.executeCommand('pcbjs.open2D')
      await wait('Quad 2D pane', () => panes().some(t => t.label.startsWith('Quad | 2D')), 120000)
      const before = panes().length
      await vscode.commands.executeCommand('pcbjs.open2D')
      assert.equal(panes().length, before)
    })
    await check('open3D beside retains source and creates a distinct view pane', async () => {
      await showSource()
      await vscode.commands.executeCommand('pcbjs.open3DBeside')
      await wait('3D pane', () => panes().some(t => t.label.includes('3D')))
      assert.ok(tabs().some(t => t.label === 'quad.pcb.tsx'))
      assert.ok(panes().some(t => t.label.includes('2D')))
      const sourceTab = tabs().find(t => t.label === 'quad.pcb.tsx')
      assert.notEqual(panes().find(t => t.label.includes('3D')).column, sourceTab.column)
    })
    if (process.env.PCBJS_HOST_DEVTOOLS) {
      await devtoolsCheck()
      result.stage = 'devtools-only-complete'
      report()
      return
    }
    await check('open2DNew creates an intentional second 2D pane', async () => {
      await showSource()
      const before = panes().length
      await vscode.commands.executeCommand('pcbjs.open2DNew')
      await wait('second 2D pane', () => panes().length === before + 1)
      assert.equal(panes().filter(t => t.label.includes('2D')).length, 2)
    })
    await check('native view QuickPick cancellation does not open a pane', async () => {
      const before = panes().length
      const picking = vscode.commands.executeCommand('pcbjs.pickView')
      await new Promise(r => setTimeout(r, 300))
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen')
      await picking
      assert.equal(panes().length, before)
    })
    await check('preview command follows the active source project in a multi-root workspace', async () => {
      const other = vscode.workspace.workspaceFolders[1].uri.fsPath
      const badge = await vscode.workspace.openTextDocument(path.join(other, 'pcb.tsx'))
      await vscode.window.showTextDocument(badge, { preview: false, viewColumn: vscode.ViewColumn.One })
      await vscode.commands.executeCommand('pcbjs.open2D')
      await wait('Badge preview title', () => panes().some(t => t.active && t.label.startsWith('Badge |')), 120000)
      await showSource()
      await vscode.commands.executeCommand('pcbjs.open2D')
      await wait('Quad preview title', () => panes().some(t => t.active && t.label.startsWith('Quad |')), 120000)
      await vscode.commands.executeCommand('pcbjs.sidebar.open', { kind: 'board', name: 'Badge', project: other, entry: path.join(other, 'pcb.tsx') })
      await wait('cross-project board row selects captured Badge source', () => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(other, 'pcb.tsx') && !vscode.window.activeTextEditor.selection.isEmpty)
      assert.ok(!vscode.window.activeTextEditor.selection.isEmpty)
      await vscode.commands.executeCommand('pcbjs.sidebar.open', { kind: 'board', name: 'Quad', project: root, entry: source })
      await wait('cross-project board row selects captured Quad source', () => vscode.window.activeTextEditor?.document.uri.fsPath === source && !vscode.window.activeTextEditor.selection.isEmpty)
      // The following checks target Quad. Do not leave a Badge tab to become
      // active and legitimately switch projects when a checks pane closes.
      const badgeTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && t.input.uri.fsPath === badge.uri.fsPath)
      await vscode.window.tabGroups.close(badgeTabs, true)

    })
    if (!process.env.PCBJS_HOST_PAD_API) await probe('activate-workbench', [])
    const padBefore = doc.getText()
    const padEditor = await showSource()
    const padText = '\nvoid R1[1]\n'
    const padStart = doc.getText().length
    assert.equal(await padEditor.edit(b => b.insert(doc.positionAt(padStart), padText), { undoStopBefore: true, undoStopAfter: true }), true)
    const padAt = doc.positionAt(padStart + padText.indexOf('[1') + 1)
    padEditor.selection = new vscode.Selection(padAt, padAt)
    padEditor.revealRange(new vscode.Range(padAt, padAt), vscode.TextEditorRevealType.InCenter)
    await check('installed standard pad signature provider returns a numbered footprint and one pad parameter', async () => {
      const hint = await wait('numbered pad signature provider', async () => {
        const result = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', doc.uri, padAt)
        return result?.signatures?.find(s => s.label === 'R1[pad]')
      })
      assert.equal(hint.parameters.length, 1)
      const markdown = typeof hint.documentation === 'string' ? hint.documentation : hint.documentation?.value
      assert.match(markdown, /data:image\/(?:png|svg\+xml);base64,/)
      assert.match(markdown, /Footprint orientation/)
      fs.writeFileSync(path.join(path.dirname(process.env.PCBJS_HOST_REPORT), 'pad-signature.md'), markdown)
      result.padSignature = { label: hint.label, parameters: hint.parameters.map(p => p.label), caret: padAt, version: doc.version }
    })
    if (!process.env.PCBJS_HOST_PAD_API) await check('caret automatically opens a loaded footprint hint and leaving the index dismisses it', async () => {
      const before = doc.getText(), caret = padEditor.selection
      await probe('pad-hint-state', [], false, { visible: true })
      assert.equal(vscode.window.activeTextEditor, padEditor)
      assert.ok(padEditor.selection.isEqual(caret))
      assert.equal(doc.getText(), before)
      const outside = doc.positionAt(0)
      padEditor.selection = new vscode.Selection(outside, outside)
      await probe('pad-hint-state', [], false, { visible: false })
      assert.equal(vscode.window.activeTextEditor, padEditor)
      assert.equal(doc.getText(), before)
    })
    result.padSignatures = [{ syntax: 'R1[1]', ...result.padSignature }]
    for (const [name, expression, delta] of [['empty', 'R1[]', 1], ['quoted', "R1['1']", 2]]) {
      await check(`installed pad signature provider handles ${name} index through source repair and injection`, async () => {
        const text = `\nvoid ${expression}\n`
        assert.equal(await padEditor.edit(b => b.replace(new vscode.Range(doc.positionAt(padStart), doc.positionAt(doc.getText().length)), text), { undoStopBefore: true, undoStopAfter: true }), true)
        const position = doc.positionAt(padStart + text.indexOf('[') + delta)
        padEditor.selection = new vscode.Selection(position, position)
        const before = doc.getText()
        const hint = await wait(`${name} pad signature provider`, async () => {
          const help = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', doc.uri, position)
          return help?.signatures?.find(s => s.label === 'R1[pad]')
        })
        assert.equal(hint.parameters.length, 1)
        const markdown = typeof hint.documentation === 'string' ? hint.documentation : hint.documentation?.value
        assert.match(markdown, /data:image\/(?:png|svg\+xml);base64,/)
        assert.match(markdown, /Footprint orientation/)
        assert.match(markdown, /pads: `1`, `2`/)
        assert.equal(doc.getText(), before)
        assert.ok(padEditor.selection.active.isEqual(position))
        fs.writeFileSync(path.join(path.dirname(process.env.PCBJS_HOST_REPORT), `pad-signature-${name}.md`), markdown)
        result.padSignatures.push({ syntax: expression, label: hint.label, parameters: hint.parameters.map(p => p.label), caret: position, version: doc.version })
      })
    }
    assert.equal(await padEditor.edit(b => b.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), padBefore), { undoStopBefore: true, undoStopAfter: true }), true)
    await devtoolsCheck()
    if (process.env.PCBJS_HOST_PAD_API) {
      result.stage = 'pad-api-complete'
      report()
      return
    }
    const disk = fs.readFileSync(source, 'utf8')
    await showSource()
    const edit = new vscode.WorkspaceEdit()
    edit.insert(doc.uri, doc.positionAt(doc.getText().length), '\n// pane history first\n')
    await vscode.workspace.applyEdit(edit)
    const first = doc.getText()
    const editor = await showSource()
    assert.equal(await editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// pane history later editor insertion\n'), { undoStopBefore: true, undoStopAfter: true }), true)
    await wait('pane history insertion applied', () => doc.getText() !== first)
    const second = doc.getText()
    await vscode.commands.executeCommand('pcbjs.open2D')
    if (!process.env.PCBJS_HOST_DIAGNOSE) await check('installed pane refuses multi-document native undo without mutating either buffer', async () => {
      const otherFile = path.join(root, 'blinky.pcb.tsx')
      const other = await vscode.workspace.openTextDocument(otherFile)
      const before = other.getText()
      await probe('pane-multi-document', [source, otherFile])
      await new Promise(r => setTimeout(r, 500))
      assert.equal(doc.getText(), second)
      assert.equal(other.getText(), before)
    })
    if (process.env.PCBJS_HOST_DIAGNOSE) {
      result.diagnostics = []
      const stage = async name => {
        const state = {name,closed:doc.isClosed,currentSame:vscode.window.activeTextEditor?.document === doc,currentFirst:vscode.window.activeTextEditor?.document.getText() === first,currentSecond:vscode.window.activeTextEditor?.document.getText() === second,openSources:vscode.workspace.textDocuments.filter(d=>d.uri.toString()===doc.uri.toString()).map(d=>({same:d===doc,closed:d.isClosed,version:d.version,head:d.getText().slice(0,100)})),active:vscode.window.activeTextEditor?.document.uri.fsPath,column:vscode.window.activeTextEditor?.viewColumn,tabs:tabs(),isFirst:doc.getText()===first,isSecond:doc.getText()===second,head:doc.getText().slice(0,100)}
        result.diagnostics.push(state)
        report()
        await probe('diagnostic-'+name,[source])
      }
      if(process.env.PCBJS_HOST_DIAGNOSE==='focus-command') {
        await check('unbroken source show, explicit group focus and native undo restore the exact prior buffer',async()=>{
          await vscode.window.showTextDocument(doc,{preview:false,preserveFocus:false,viewColumn:vscode.ViewColumn.One})
          await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
          await vscode.commands.executeCommand('undo')
          await wait('unbroken focus-command native undo',()=>doc.getText()===first)
        })
        await stage('after-unbroken-native-undo')
        result.stage='diagnostic-complete'
        report()
        return
      }
      await probe('diagnostic-handler',[source])
      await stage('before-show')
      await vscode.window.showTextDocument(doc,{preview:false,preserveFocus:false,viewColumn:vscode.ViewColumn.One})
      await stage('after-show')
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
      await stage('after-focus-group')
      await vscode.commands.executeCommand('undo')
      await new Promise(r=>setTimeout(r,300))
      await stage('after-native-undo')
      await vscode.commands.executeCommand('undo')
      await new Promise(r=>setTimeout(r,300))
      await stage('after-second-native-undo')
      await vscode.commands.executeCommand('default:undo')
      await new Promise(r=>setTimeout(r,300))
      await stage('after-default-native-undo')
      await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup')
      await vscode.commands.executeCommand('undo')
      await new Promise(r=>setTimeout(r,300))
      await stage('after-first-column-native-undo')
      result.stage='diagnostic-complete'
      report()
      return
    }
    if (!process.env.PCBJS_HOST_FINDING_GROUPS) {
    await check('installed pane undo action uses native chronological history and restores pane focus', async () => {
      await probe('pane-undo', [source])
      await wait('pane undo source buffer', () => doc.getText() === first)
      await wait('pane focus restored after undo', () => panes().some(t => t.active))
      assert.equal(fs.readFileSync(source, 'utf8'), disk)
    })
    await check('installed pane redo action restores the same source buffer without saving', async () => {
      await probe('pane-redo', [source], true)
      await wait('pane redo source buffer', () => doc.getText() === second)
      await wait('pane focus restored after redo', () => panes().some(t => t.active))
      assert.equal(fs.readFileSync(source, 'utf8'), disk)
    })
    await check('successive keyboard undo and redo use native history from a reloaded preview', async () => {
      await vscode.commands.executeCommand('pcbjs.preview.reload')
      await probe('pane-undo', [source])
      await wait('reloaded pane undo source history', () => doc.getText() === first)
      await probe('pane-undo', [source])
      await wait('second native undo source history', () => doc.getText() === disk)
      await probe('pane-redo', [source], true)
      await wait('first native redo source history', () => doc.getText() === first)
      await probe('pane-redo', [source], true)
      await wait('second native redo source history', () => doc.getText() === second)
    })
    await check('physical preview selection and R edit undo and redo through native source history', async () => {
      await probe('pane-rotate', [source])
      await wait('preview rotation edits source', () => doc.getText() !== second)
      const rotated = doc.getText()
      await probe('pane-undo', [source])
      await wait('keyboard undo preview rotation', () => doc.getText() === second)
      await probe('pane-redo', [source], true)
      await wait('keyboard redo preview rotation', () => doc.getText() === rotated)
      await probe('pane-undo', [source])
      await wait('rotation restored before remaining checks', () => doc.getText() === second)
    })
    await check('actual modal Mod+P opens native Quick Input without changing the source buffer',async()=>{
      const before=doc.getText()
      await probe('modal-quickopen',[source])
      assert.equal(doc.getText(),before)
    })
    }
    await showSource()
    await vscode.commands.executeCommand('workbench.action.files.revert')
    const WebSocket = require('ws')
    const info = JSON.parse(fs.readFileSync(path.join(root, '.pcbjs/dev.json'), 'utf8'))
    const socket = new WebSocket(`ws://127.0.0.1:${new URL(info.url).port}/__pcbjs/session`)
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    const waits = new Map(), events = []
    let rpcId = 0
    socket.on('message', raw => {
      const m = JSON.parse(String(raw))
      if (m.event) events.push({ event: m.event, ...m.data })
      const w = waits.get(m.id)
      if (w) { waits.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result) }
    })
    socket.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: 'installed acceptance', version: '0', protocol: 6, major: 1, capabilities: ['finding'], role: 'agent', project: root } }))
    const request = (method, params = {}) => new Promise((resolve, reject) => {
      waits.set(++rpcId, { resolve, reject })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }))
    })
    let nativeFinding
    const isChecks = t => t?.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith('pcbjs.preview') && / \| DRC\/ERC(?: \(\d+\))?$/.test(t.label)
    const findingTabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(isChecks)
    const activateFinding = async () => {
      const tab = findingTabs()[0]
      const group = vscode.window.tabGroups.all.find(g => g.tabs.includes(tab))
      // Tab groups retain creation order after splits, not visual column order.
      const number = group.viewColumn - 1
      const names = ['First', 'Second', 'Third', 'Fourth']
      assert.ok(number >= 0 && number < names.length)
      await vscode.commands.executeCommand(`workbench.action.focus${names[number]}EditorGroup`)
      await vscode.commands.executeCommand(`workbench.action.openEditorAtIndex${group.tabs.indexOf(tab) + 1}`)
      await wait('checks viewer active', () => vscode.window.tabGroups.activeTabGroup.activeTab === tab)
      return tab
    }
    try {
      await check('folder expansion and repeated board click preserve native webview frame identity and board source selection', async () => {
        await vscode.commands.executeCommand('pcbjs.sidebar.open', { kind: 'board', name: 'Quad', project: root })
        await wait('source selected for Quad board', () => vscode.window.activeTextEditor?.document.uri.fsPath === source && !vscode.window.activeTextEditor.selection.isEmpty)
        const before = await probe('frame-state', [])
        await vscode.commands.executeCommand('pcbjs.sidebar.open', { kind: 'scope', project: root, root, route: '/', id: `config:${path.join(root, 'pcb.config.ts')}` })
        const expanded = await probe('frame-state', [])
        assert.deepEqual(expanded.frames, before.frames)
        await vscode.commands.executeCommand('pcbjs.sidebar.open', { kind: 'board', name: 'Quad', project: root })
        const after = await probe('frame-state', [])
        assert.deepEqual(after.frames, before.frames)
        assert.ok(vscode.window.activeTextEditor?.selection && !vscode.window.activeTextEditor.selection.isEmpty)
      })
      await check('canonical finding opens a persistent fourth HTML viewer with entity selection and Copy as Markdown', async () => {
        const original = doc.getText()
        assert.ok(original.includes('<J1 at="3 6.23"'), 'scratch source contains the placement being changed')
        const text = original.replace('<J1 at="3 6.23"', '<J1 at="300 600"')
        assert.notEqual(text, original)
        const changed = new vscode.WorkspaceEdit()
        changed.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text)
        assert.equal(await vscode.workspace.applyEdit(changed), true)
        assert.equal(doc.getText(), text)
        const synced = await wait('session receives the scratch placement edit', async () => {
          const read = await request('session/read', { file: source })
          return read.text === text ? read : null
        })
        result.findingMutation = { file: source, version: doc.version, authority: synced.authority, synchronized: true }
        await request('session/check', { project: root })
        const report = await request('session/findings', { project: root, board: 'Quad' })
        const finding = report.boards.flatMap(b => b.findings).find(f => f.rule === 'unconnected' && f.refs?.length)
        assert.ok(finding, 'scratch placement outside the outline creates a real finding')
        nativeFinding = finding
        result.finding = finding.id
        await request('session/select', { project: root, board: 'Quad', refs: [finding.id] })
        await wait('native finding tab', () => findingTabs().length === 1)
        const focused = await probe('frame-state', [])
        result.findingFrames = focused.frames
        assert.ok(focused.frames.some(f => f.url.includes('/board/Quad') && new URL(f.url).searchParams.get('view') === '2d'))
        assert.ok(focused.frames.some(f => f.url.includes('/board/Quad') && new URL(f.url).searchParams.get('view') === '3d'))
        assert.ok(focused.frames.filter(f => f.url.includes('/board/Quad')).every(f => new URL(f.url).searchParams.get('focus') === finding.id), 'finding focus is mirrored in the canonical URLs of every Quad pane')

        const rendered = await probe('finding-html', [])
        assert.match(rendered.heading, /Unconnected/i)
        assert.ok(rendered.text.includes('Quad') && rendered.text.includes('not fully connected'))
        assert.ok(rendered.text.includes('Location') && rendered.text.includes(finding.id))
        assert.ok(finding.refs.every(ref => rendered.refs.includes(ref)))
        assert.equal(rendered.copy?.label, 'Copy as Markdown')
        assert.equal(rendered.copy?.title, 'Copy as Markdown')
        assert.equal(rendered.copy?.visibleText, '')
        assert.ok(!vscode.workspace.textDocuments.some(d => d.uri.scheme === 'pcbjs-finding'), 'finding is an HTML pane rather than a text document')
        result.findingHtml = rendered
        const ref = finding.refs[1] ?? finding.refs[0]
        const entityFrom = events.length
        await probe('finding-entity', [], false, { ref })
        await wait('HTML entity click updates canonical selection', () => events.slice(entityFrom).some(e => e.event === 'pcbjs:ide:finding' && e.anchor === ref && e.finding?.id === finding.id))
        const previousClipboard = await vscode.env.clipboard.readText()
        try {
          const marker = `finding-copy-${Date.now()}`
          await vscode.env.clipboard.writeText(marker)
          await probe('finding-copy', [])
          const markdown = await wait('Copy as Markdown writes the native clipboard', async () => {
            const copied = await vscode.env.clipboard.readText()
            return copied !== marker ? copied : null
          })
          assert.match(markdown, /^# Unconnected\n/)
          assert.ok(markdown.includes('Board `Quad`') && markdown.includes('not fully connected'))
          assert.ok(markdown.includes(finding.id) && finding.refs.every(ref => markdown.includes(ref)))
          fs.writeFileSync(path.join(path.dirname(process.env.PCBJS_HOST_REPORT), 'finding-copy.md'), markdown)
          result.findingCopy = { format: 'Markdown', references: finding.refs, length: markdown.length }
          assert.equal(findingTabs().length, 1, 'copy keeps the HTML pane open')
        } finally { await vscode.env.clipboard.writeText(previousClipboard) }
        const tab = await activateFinding()
        await showSource()
        assert.equal(findingTabs()[0], tab, 'source focus keeps the persistent checks tab')
        await activateFinding()
        const afterSource = await probe('finding-html', [])
        assert.equal(afterSource.targetId, rendered.targetId)
        assert.equal(afterSource.timeOrigin, rendered.timeOrigin)
        assert.ok(afterSource.rows.some(row => row.id === finding.id && row.current))
        await request('session/select', { project: root, board: 'Quad', refs: [], finding: null })
        const unfocused = await probe('finding-html', [])
        assert.equal(findingTabs()[0], tab)
        assert.equal(unfocused.targetId, rendered.targetId)
        assert.equal(unfocused.timeOrigin, rendered.timeOrigin)
        assert.ok(unfocused.rows.length && !unfocused.rows.some(row => row.current), 'cleared focus retains the list')
        assert.equal(unfocused.copy.disabled, true)
        result.findingPersistence = { sourceFocus: afterSource, clearedFocus: unfocused }
        await request('session/select', { project: root, board: 'Quad', refs: [finding.id] })
        const closedFrom = events.length
        await vscode.window.tabGroups.close(findingTabs()[0], true)
        await wait('closing last checks viewer clears server focus', () => events.slice(closedFrom).some(e => e.event === 'pcbjs:ide:finding' && e.finding === null))
      })
      await check('checks list, collapse and previous/next update canonical focus without replacing the tab or iframe', async () => {
        await request('session/select', { project: root, board: 'Quad', refs: [nativeFinding.id] })
        await wait('checks viewer opened for navigation', () => findingTabs().length === 1)
        await activateFinding()
        const tab = findingTabs()[0]
        const initial = await probe('finding-html', [])
        const index = initial.rows.findIndex(row => row.id === nativeFinding.id)
        assert.ok(index >= 0 && index + 1 < initial.rows.length)
        const sameFrame = state => {
          assert.equal(findingTabs()[0], tab)
          assert.equal(state.targetId, initial.targetId)
          assert.equal(state.timeOrigin, initial.timeOrigin)
        }
        const nextFrom = events.length
        await probe('finding-next', [])
        await wait('next finding canonical focus', () => events.slice(nextFrom).some(e => e.event === 'pcbjs:ide:finding' && e.finding?.id === initial.rows[index + 1].id))
        const next = await probe('finding-html', [])
        sameFrame(next)
        assert.ok(next.rows[index + 1].current)
        const previousFrom = events.length
        await probe('finding-previous', [])
        await wait('previous finding canonical focus', () => events.slice(previousFrom).some(e => e.event === 'pcbjs:ide:finding' && e.finding?.id === nativeFinding.id))
        const previous = await probe('finding-html', [])
        sameFrame(previous)
        const selected = initial.rows.find(row => row.id !== nativeFinding.id)
        const rowFrom = events.length
        await probe('finding-row', [], false, { finding: selected.id })
        await wait('list row canonical focus', () => events.slice(rowFrom).some(e => e.event === 'pcbjs:ide:finding' && e.finding?.id === selected.id))
        const row = await probe('finding-html', [])
        sameFrame(row)
        assert.ok(row.rows.some(r => r.id === selected.id && r.current))
        assert.equal(row.previousDisabled, selected.id === initial.rows[0].id)
        await probe('finding-toggle', [])
        const collapsed = await probe('finding-html', [])
        sameFrame(collapsed)
        assert.equal(collapsed.listExpanded, 'false')
        assert.equal(collapsed.listVisible, false)
        await probe('finding-toggle', [])
        const expanded = await probe('finding-html', [])
        sameFrame(expanded)
        assert.equal(expanded.listExpanded, 'true')
        assert.equal(expanded.listVisible, true)
        result.findingNavigation = { initial, next, previous, row, collapsed, expanded }
        const closedFrom = events.length
        await vscode.window.tabGroups.close(tab, true)
        await wait('closing navigation viewer clears focus', () => events.slice(closedFrom).some(e => e.event === 'pcbjs:ide:finding' && e.finding === null))

      })
      const isPreview = tab => tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('pcbjs.preview') && !isChecks(tab)
      const previewLabels = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(isPreview).map(t => t.label).sort()
      const findingGroup = () => vscode.window.tabGroups.all.find(g => g.tabs.some(t => findingTabs().includes(t)))
      const openFinding = async () => {
        if (findingTabs().length) await vscode.window.tabGroups.close(findingTabs(), true)
        await wait('previous checks viewer closed', () => findingTabs().length === 0)
        await request('session/select', { project: root, board: 'Quad', refs: [nativeFinding.id] })
        await wait('persistent checks viewer opened', () => findingTabs().length === 1)
      }
      const clearFinding = async () => {
        const from = events.length
        await vscode.window.tabGroups.close(findingTabs(), true)
        await wait('checks viewer closed', () => findingTabs().length === 0)
        await wait('closed checks viewer clears canonical focus', () => events.slice(from).some(e => e.event === 'pcbjs:ide:finding' && e.finding === null))
      }
      const recordGroups = () => vscode.window.tabGroups.all.map(g => ({ column: g.viewColumn, active: g.isActive, activeTab: g.activeTab?.label, tabs: g.tabs.map(t => t.label) }))
      result.findingGroupChecks = {}
      await check('finding editor prefers the relevant source group and preserves active preview visibility and focus', async () => {
        await showSource()
        const sourceGroup = vscode.window.tabGroups.all.find(g => g.activeTab?.input instanceof vscode.TabInputText && g.activeTab.input.uri.fsPath === source)
        assert.ok(sourceGroup)
        await vscode.commands.executeCommand('pcbjs.open2D')
        await wait('active Quad preview', () => isPreview(vscode.window.tabGroups.activeTabGroup.activeTab) && vscode.window.tabGroups.activeTabGroup.activeTab.label === 'Quad | 2D')
        const active = vscode.window.tabGroups.activeTabGroup
        const preview = active.activeTab
        const labels = previewLabels()
        const count = vscode.window.tabGroups.all.length
        assert.notEqual(active, sourceGroup)
        await openFinding()
        assert.equal(findingGroup(), sourceGroup)
        assert.equal(vscode.window.tabGroups.all.length, count)
        assert.equal(vscode.window.tabGroups.activeTabGroup, active)
        assert.equal(active.activeTab, preview)
        assert.deepEqual(previewLabels(), labels)
        result.findingGroupChecks.source = recordGroups()
        await clearFinding()
        assert.equal(active.activeTab, preview)
      })
      await check('finding editor uses an inactive preview group when every group shows a preview', async () => {
        await doc.save()
        const textTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText)
        await vscode.window.tabGroups.close(textTabs, true)
        await vscode.commands.executeCommand('vscode.setEditorLayout', { groups: [{}] })
        await vscode.commands.executeCommand('pcbjs.open2D')
        await wait('one group containing only previews', () => vscode.window.tabGroups.all.length === 1 && vscode.window.tabGroups.all[0].tabs.every(isPreview) && vscode.window.tabGroups.activeTabGroup.activeTab?.label === 'Quad | 2D')
        await vscode.commands.executeCommand('workbench.action.newGroupRight')
        await vscode.commands.executeCommand('pcbjs.open3D')
        await wait('3D preview ready to move', () => vscode.window.tabGroups.activeTabGroup.activeTab?.label === 'Quad | 3D')
        await vscode.commands.executeCommand('moveActiveEditor', { to: 'next', by: 'group' })
        await wait('two groups displaying previews', () => vscode.window.tabGroups.all.length === 2 && vscode.window.tabGroups.all.every(g => isPreview(g.activeTab)))
        const active = vscode.window.tabGroups.activeTabGroup
        const preview = active.activeTab
        const inactive = vscode.window.tabGroups.all.find(g => g !== active)
        const labels = previewLabels()
        await openFinding()
        assert.equal(findingGroup(), inactive)
        assert.equal(vscode.window.tabGroups.all.length, 2)
        assert.equal(vscode.window.tabGroups.activeTabGroup, active)
        assert.equal(active.activeTab, preview)
        assert.deepEqual(previewLabels(), labels)
        result.findingGroupChecks.inactivePreview = recordGroups()
        await clearFinding()
        assert.equal(active.activeTab, preview)
      })
      await check('finding editor creates a split for a sole active preview and leaves that preview focused', async () => {
        await vscode.commands.executeCommand('vscode.setEditorLayout', { groups: [{}] })
        await vscode.commands.executeCommand('pcbjs.open2D')
        await wait('sole preview group', () => vscode.window.tabGroups.all.length === 1 && isPreview(vscode.window.tabGroups.activeTabGroup.activeTab) && vscode.window.tabGroups.activeTabGroup.activeTab.label === 'Quad | 2D')
        const active = vscode.window.tabGroups.activeTabGroup
        const preview = active.activeTab
        const labels = previewLabels()
        await openFinding()
        await wait('finding editor opened in a split', () => vscode.window.tabGroups.all.length === 2)
        assert.notEqual(findingGroup(), active)
        assert.equal(vscode.window.tabGroups.activeTabGroup, active)
        assert.equal(active.activeTab, preview)
        assert.deepEqual(previewLabels(), labels)
        result.findingGroupChecks.solePreview = recordGroups()
        const from = events.length
        const findingEvents = () => events.filter(e => e.event === 'pcbjs:ide:finding').slice(-6).map(e => ({ finding: e.finding?.id ?? null, refs: e.refs, anchor: e.anchor }))
        const closedDocuments = [], closedTabs = []
        const closeDoc = vscode.workspace.onDidCloseTextDocument(d => closedDocuments.push(d.uri.toString()))
        const closeTab = vscode.window.tabGroups.onDidChangeTabs(e => closedTabs.push(...e.closed.map(t => t.input instanceof vscode.TabInputText ? t.input.uri.toString() : t.input instanceof vscode.TabInputWebview ? `${t.input.viewType}:${t.label}` : t.label)))
        result.findingSplitClose = { before: findingEvents(), closedDocuments, closedTabs }
        report()
        try {
          await vscode.window.tabGroups.close(findingTabs()[0], true)
          await wait('closing split finding clears canonical focus', () => {
            result.findingSplitClose.after = findingEvents()
            result.findingSplitClose.documents = vscode.workspace.textDocuments.filter(d => d.uri.scheme === 'pcbjs-finding').map(d => d.uri.toString())
            return events.slice(from).some(e => e.event === 'pcbjs:ide:finding' && e.finding === null)
          })
          assert.equal(active.activeTab, preview)
        } finally { closeDoc.dispose(); closeTab.dispose() }
      })
      await check('openAllViews includes the persistent DRC/ERC fourth viewer', async () => {
        await vscode.commands.executeCommand('pcbjs.openAllViews')
        await wait('all four pcbjs viewer kinds', () => ['2D', '3D', 'Schematic', 'DRC/ERC'].every(view => tabs().some(t => t.label === `Quad | ${view}`)))
        assert.equal(findingTabs().length, 1)
        result.allViewerTabs = tabs()
      })
    } finally { socket.close() }
    await showSource()
    await vscode.commands.executeCommand('workbench.action.files.revert')
    result.tabs = tabs()
    result.stage = 'host-api-complete'
    report()
    if (process.env.PCBJS_HOST_WAIT) await wait('external browser probe', () => fs.existsSync(process.env.PCBJS_HOST_WAIT), 120000)
  } finally {
    changes.dispose()
    result.tabs = tabs()
    report()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('pcbjs.stop')
  }
}
