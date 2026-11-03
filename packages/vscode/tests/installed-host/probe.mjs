import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inputKey } from './platform.mjs'
// Dispatch through the installed webview's own bridge, without changing the candidate extension.
export async function webviewAction(port, action, out) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(10000) }).then(r => r.json())
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((done, fail) => {
    const finish = error => {
      clearTimeout(timer)
      ws.removeEventListener('open', opened)
      ws.removeEventListener('error', failed)
      ws.removeEventListener('close', closed)
      if (error) { ws.close(); fail(error) } else done()
    }
    const opened = () => finish()
    const failed = () => finish(new Error('CDP connection failed'))
    const closed = () => finish(new Error('CDP connection closed before opening'))
    const timer = setTimeout(() => finish(new Error('CDP connection timed out')), 10000)
    ws.addEventListener('open', opened, { once: true })
    ws.addEventListener('error', failed, { once: true })
    ws.addEventListener('close', closed, { once: true })
  })
  let id = 0
  const waiting = new Map(), contexts = new Map(), runtime = []
  let onPause
  const rejectPending = () => {
    for (const w of waiting.values()) w.fail(new Error('CDP connection closed'))
  }
  ws.addEventListener('close', rejectPending)
  ws.addEventListener('error', rejectPending)

  ws.addEventListener('message', event => {
    const m = JSON.parse(String(event.data))
    if (m.method === 'Debugger.paused') void onPause?.(m)
    if (['Runtime.consoleAPICalled', 'Runtime.exceptionThrown'].includes(m.method)) {
      runtime.push({ sessionId: m.sessionId, method: m.method, params: m.params })
      writeFileSync(join(out, 'finding-runtime.json'), JSON.stringify(runtime.slice(-200), null, 2))
    }
    if (m.method === 'Runtime.executionContextCreated') {
      const list = contexts.get(m.sessionId) ?? []
      list.push(m.params.context)
      contexts.set(m.sessionId, list)
    }
    const w = waiting.get(m.id)
    if (w) { waiting.delete(m.id); m.error ? w.fail(new Error(m.error.message)) : w.done(m.result) }
  })
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const requestId = ++id
    const finish = (callback, value) => { clearTimeout(timer); waiting.delete(requestId); callback(value) }
    const timer = setTimeout(() => finish(fail, new Error(`CDP request timed out: ${method}`)), 15000)
    waiting.set(requestId, { done: value => finish(done, value), fail: error => finish(fail, error) })
    try {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('CDP connection is not open')
      ws.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }))
    } catch (error) { finish(fail, error) }
  })
  const inspected = []
  let focusedBoard = null
  try {
    const { targetInfos } = await send('Target.getTargets')
    writeFileSync(join(out,'targets.json'),JSON.stringify(targetInfos,null,2))
    if (action.kind === 'activate-workbench') {
      const target = targetInfos.find(t => t.type === 'page' && t.url.includes('workbench'))
      const native = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      try {
        await send('Page.bringToFront', {}, native.sessionId)
        let focused = false
        for (let n = 0; n < 30 && !focused; n++) {
          focused = (await send('Runtime.evaluate', { expression: 'document.hasFocus()', returnByValue: true }, native.sessionId)).result?.value === true
          if (!focused) await new Promise(resolve => setTimeout(resolve, 100))
        }
        return { kind: action.kind, focused, ...(!focused ? { error: 'The isolated test workbench could not acquire native focus' } : {}) }
      } finally { await send('Target.detachFromTarget', { sessionId: native.sessionId }) }
    }
    if (action.kind === 'pad-hint-state') {
      const target = targetInfos.find(t => t.type === 'page' && t.url.includes('workbench'))
      const native = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      try {
        let state
        for (let n = 0; n < 40; n++) {
          const evaluated = await send('Runtime.evaluate', { expression: `(() => {const widgets=[...document.querySelectorAll('.parameter-hints-widget')].filter(e=>e.classList.contains('visible')&&e.getBoundingClientRect().width>0);const widget=widgets.find(e=>e.innerText.includes('R1'));return {visible:!!widget,text:widget?.innerText,images:[...(widget?.querySelectorAll('img')??[])].map(e=>({complete:e.complete,width:e.naturalWidth,height:e.naturalHeight})),focused:document.hasFocus(),active:{tag:document.activeElement?.tagName,cls:document.activeElement?.className},widgets:[...document.querySelectorAll(".parameter-hints-widget")].map(e=>({text:e.innerText,classes:e.className,width:e.getBoundingClientRect().width}))}})()`, returnByValue:true }, native.sessionId)
          state = evaluated.result?.value
          if (action.visible ? state?.visible && state.images.some(i=>i.complete&&i.width>0) : !state?.visible) break
          await new Promise(r=>setTimeout(r,100))
        }
        writeFileSync(join(out, 'pad-hint-' + (action.visible ? 'shown' : 'dismissed') + '.json'), JSON.stringify(state,null,2))
        const screenshot = await send('Page.captureScreenshot', {format:'png'}, native.sessionId)
        writeFileSync(join(out, 'pad-hint-' + (action.visible ? 'shown' : 'dismissed') + '.png'), Buffer.from(screenshot.data,'base64'))
        return {kind:action.kind,...state,...((action.visible ? !state?.visible || !state.images.some(i=>i.complete&&i.width>0) : state?.visible) ? {error:'Native pad footprint hint visibility or image loading did not match'} : {})}
      } finally {await send('Target.detachFromTarget',{sessionId:native.sessionId})}
    }
    if (action.kind === 'diagnostic-handler') {
      const target = targetInfos.find(t => t.type === 'page' && t.url.includes('workbench'))
      const native = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      const traces = []
      onPause = async m => {
        try {
          const frame = m.params.callFrames[0]
          const result = await send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: `({uri:u.getModel()?.uri.toString(),canUndo:u.getModel()?.canUndo(),readonly:u.getOption(105),text:u.getModel()?.getValue().slice(0,100),focus:u.hasTextFocus(),active:l.get(ki).getActiveCodeEditor()?.getModel()?.uri.toString(),editors:l.get(ki).listCodeEditors().map(e=>({uri:e.getModel()?.uri.toString(),textFocus:e.hasTextFocus(),widgetFocus:e.hasWidgetFocus(),domFocus:e.getDomNode()?.contains(document.activeElement)})),dom:{focus:document.hasFocus(),tag:document.activeElement?.tagName,cls:document.activeElement?.className}})`, returnByValue: true }, m.sessionId)
          traces.push(result)
          writeFileSync(join(out, 'native-undo-handler.json'), JSON.stringify(traces, null, 2))
        } finally { await send('Debugger.resume', {}, m.sessionId) }
      }
      await send('Debugger.enable', {}, native.sessionId)
      const app = await import('node:fs').then(fs => fs.readFileSync('/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js', 'utf8'))
      const offset = app.indexOf('runEditorCommand(l,u,p){if(!(!u.hasModel()') + 'runEditorCommand(l,u,p){'.length
      const lines = app.slice(0, offset).split('\n')
      await send('Debugger.setBreakpointByUrl', { urlRegex: 'workbench\\.desktop\\.main\\.js$', lineNumber: lines.length - 1, columnNumber: lines.at(-1).length }, native.sessionId)
      try {
        for (const wrapper of targetInfos.filter(t => t.url.startsWith('vscode-webview:'))) {
          const a = await send('Target.attachToTarget', { targetId: wrapper.targetId, flatten: true })
          await send('Runtime.enable', {}, a.sessionId)
          for (const c of contexts.get(a.sessionId) ?? []) {
            const r = await send('Runtime.evaluate', { contextId: c.id, expression: `typeof vscode !== 'undefined' && !!document.getElementById('viewer') && (vscode.postMessage({type:'undo',files:${JSON.stringify(action.files)}}), true)`, returnByValue: true }, a.sessionId)
            if (r.result?.value) {
              for (let n = 0; n < 40 && !traces.length; n++) await new Promise(r => setTimeout(r, 100))
              return { kind: action.kind, traces }
            }
          }
          await send('Target.detachFromTarget', { sessionId: a.sessionId })
        }
        return { kind: action.kind, traces, missing: true }
      } finally { await send('Debugger.disable', {}, native.sessionId) }
    }
    if (['finding-html', 'finding-entity', 'finding-copy', 'finding-next', 'finding-previous', 'finding-toggle', 'finding-row'].includes(action.kind)) {
      const candidates = []
      for (const target of targetInfos.filter(t => ['page', 'iframe'].includes(t.type))) {
        const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }).catch(() => null)
        if (!attached) continue
        try {
          await send('Runtime.enable', {}, attached.sessionId)
          for (const context of [undefined, ...(contexts.get(attached.sessionId) ?? []).map(c => c.id)]) {
            const state = await send('Runtime.evaluate', { ...(context === undefined ? {} : { contextId: context }), expression: `(() => { const root = document.querySelector('.checks-view'); if (!root || document.visibilityState === 'hidden' || root.getBoundingClientRect().width === 0) return { missing: true, href: location.href, visibility: document.visibilityState, hasRoot: !!root, width: root?.getBoundingClientRect().width, body: document.body?.innerText.slice(0, 5000), html: document.body?.innerHTML.slice(0, 12000), scripts: [...document.scripts].map(e => e.src), resources: performance.getEntriesByType('resource').map(e => ({ name: e.name, duration: e.duration, size: e.transferSize, status: e.responseStatus })) }; const copy = document.getElementById('copy-markdown'), list = document.getElementById('checks-list'); return { title: document.title, href: location.href, timeOrigin: performance.timeOrigin, heading: root.querySelector('#finding-details h1')?.textContent, text: root.innerText, html: root.outerHTML, refs: [...root.querySelectorAll('[data-ref]')].map(e => e.getAttribute('data-ref')), rows: [...root.querySelectorAll('.finding-row')].map(e => ({ id: e.getAttribute('data-finding'), current: e.getAttribute('aria-current') === 'true', label: e.innerText })), listVisible: !!list && getComputedStyle(list).display !== 'none', listExpanded: root.querySelector('[aria-label="Toggle findings"]')?.getAttribute('aria-expanded'), previousDisabled: root.querySelector('[aria-label="Previous finding"]')?.disabled, nextDisabled: root.querySelector('[aria-label="Next finding"]')?.disabled, copy: copy ? { label: copy.getAttribute('aria-label'), title: copy.getAttribute('title'), visibleText: copy.innerText.trim(), disabled: copy.disabled } : null } })()`, returnByValue: true }, attached.sessionId)
            const found = state.result?.value
            candidates.push({ target: target.url, targetId: target.targetId, context, state: found, exception: state.exceptionDetails })
            writeFileSync(join(out, 'finding-candidates.json'), JSON.stringify(candidates, null, 2))
            if (!found || found.missing) continue
            writeFileSync(join(out, 'finding-rendered.html'), found.html)
            writeFileSync(join(out, 'finding-rendered.txt'), found.text)
            if (action.kind !== 'finding-html') {
              const expressions = {
                'finding-copy': `document.getElementById('copy-markdown')`,
                'finding-next': `document.querySelector('[aria-label="Next finding"]')`,
                'finding-previous': `document.querySelector('[aria-label="Previous finding"]')`,
                'finding-toggle': `document.querySelector('[aria-label="Toggle findings"]')`,
                'finding-row': `[...document.querySelectorAll('.finding-row')].find(e => e.getAttribute('data-finding') === ${JSON.stringify(action.finding)})`,
                'finding-entity': `[...document.querySelectorAll('#finding-details [data-ref]')].find(e => e.getAttribute('data-ref') === ${JSON.stringify(action.ref)})`,
              }
              const expression = expressions[action.kind]
              const click = await send('Runtime.evaluate', { ...(context === undefined ? {} : { contextId: context }), expression: `(() => { const target = ${expression}; if (!target) return false; target.click(); return true })()`, returnByValue: true }, attached.sessionId)
              if (!click.result?.value) throw new Error('Finding action element is absent')
            }
            const workbench = targetInfos.find(t => t.type === 'page' && t.url.includes('workbench'))
            if (workbench) {
              const native = await send('Target.attachToTarget', { targetId: workbench.targetId, flatten: true })
              try {
                const shot = await send('Page.captureScreenshot', { format: 'png' }, native.sessionId)
                writeFileSync(join(out, action.kind + '-workbench.png'), Buffer.from(shot.data, 'base64'))
              } finally { await send('Target.detachFromTarget', { sessionId: native.sessionId }) }
            }
            return { kind: action.kind, targetId: target.targetId, target: target.url, context, ...found, interaction: action.kind === 'finding-html' ? 'rendered DOM read' : 'CDP DOM click through installed finding handler; no direct bridge message' }
          }
        } catch (error) { candidates.push({ target: target.url, error: String(error) }); writeFileSync(join(out, 'finding-candidates.json'), JSON.stringify(candidates, null, 2)) }
        finally { await send('Target.detachFromTarget', { sessionId: attached.sessionId }).catch(() => {}) }
      }
      return null
    }
    if (action.kind === 'devtools-state') {
      let frames = []
      for (let attempt = 0; attempt < 40; attempt++) {
        frames = []
        const current = await send('Target.getTargets')
        for (const target of current.targetInfos.filter(t => /^http:\/\/127\.0\.0\.1:/.test(t.url) && t.url.includes('ide=1'))) {
          const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }).catch(() => null)
          if (!attached) continue
          try {
            const state = await send('Runtime.evaluate', { expression: `(() => {
              if (!document.querySelector('.stage')) return null
              const inspector = document.querySelector('.ui-inspector')
              const toggle = document.querySelector('[aria-label="Toggle preview dev tools"]')
              if (!window.__inspectorMessages) { window.__inspectorMessages = []; addEventListener('message', e => { if (e.data?.type === 'pcbjs:devtools') window.__inspectorMessages.push({enabled:e.data.enabled,parent:e.source === parent}) }) }
              const state = inspector ? [...inspector.querySelectorAll('details')].find(e => e.querySelector('summary')?.textContent === 'Preview state')?.querySelector('pre')?.textContent : null
              return { view: new URL(location.href).searchParams.get('view'), inspector: !!inspector, toggle: toggle?.getAttribute('aria-pressed') ?? null, messages: window.__inspectorMessages, selection: document.querySelector('.chips-bar')?.textContent?.trim() ?? '', state: state ? JSON.parse(state) : null }
            })()`, returnByValue: true }, attached.sessionId)
            if (state.result?.value) frames.push({ id: target.targetId, url: target.url, ...state.result.value })
          } finally { await send('Target.detachFromTarget', { sessionId: attached.sessionId }).catch(() => {}) }
        }
        frames.sort((a, b) => a.id.localeCompare(b.id))
        const inspectors = frames.filter(f => f.inspector)
        if (frames.some(f => f.view === '2d') && frames.some(f => f.view === '3d') && (action.enabled ? inspectors.length === 1 && inspectors[0].view === '2d' : !inspectors.length)) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      const inspectors = frames.filter(f => f.inspector)
      const matched = frames.some(f => f.view === '2d') && frames.some(f => f.view === '3d') && (action.enabled ? inspectors.length === 1 && inspectors[0].view === '2d' : !inspectors.length)
      const evidence = { kind: action.kind, frames, interaction: 'Read-only CDP DOM snapshot after native extension commands; no physical focus required', ...(!matched ? { error: 'Installed devtools visibility did not match the active 2D pane' } : {}) }
      writeFileSync(join(out, 'devtools-' + (action.enabled ? 'enabled' : 'disabled') + '.json'), JSON.stringify(evidence, null, 2))
      return evidence
    }

    if (action.kind === 'frame-state') {
      const frames = []
      for (const target of targetInfos.filter(t => /^http:\/\/127\.0\.0\.1:/.test(t.url) && t.url.includes('/board/'))) {
        const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
        try {
          const state = await send('Runtime.evaluate', { expression: `({viewBox:document.querySelector('svg.board-svg')?.getAttribute('viewBox'), focusedFindings:[...document.querySelectorAll('[data-finding].focus')].map(e=>e.getAttribute('data-finding')),selection:document.querySelector('.chips-bar')?.textContent})`, returnByValue: true }, attached.sessionId)
          frames.push({ id: target.targetId, url: target.url, ...state.result?.value })
        } finally { await send('Target.detachFromTarget', { sessionId: attached.sessionId }) }
      }
      return { kind: action.kind, frames }
    }

    for (const target of targetInfos.filter(t => ['page', 'iframe'].includes(t.type))) {
      let sessionId
      try {
        ;({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }))
        await send('Runtime.enable', {}, sessionId)
        if (target.type === 'page' && target.url.includes('workbench')) {
          if (!action.kind.startsWith('diagnostic')) {
          await send('Page.bringToFront', {}, sessionId)
          const rect = await send('Runtime.evaluate', { expression: `(() => { const frames=[...document.querySelectorAll('iframe')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}).filter(r=>r.w>200&&r.h>200); return frames[0] })()`, returnByValue:true },sessionId)
          const r = rect.result?.value
          if (r) {
            const point={x:r.x+Math.min(150,r.w/2),y:r.y+Math.min(150,r.h/2),button:'left',clickCount:1}
            await send('Input.dispatchMouseEvent',{type:'mousePressed',...point},sessionId)
            await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point},sessionId)
            await new Promise(done=>setTimeout(done,100))
          }
          for (const board of targetInfos.filter(t=>/^http:\/\/127\.0\.0\.1:/.test(t.url) && t.url.includes('/board/Quad') && t.url.includes('view=2d'))) {
            const attached = await send('Target.attachToTarget',{targetId:board.targetId,flatten:true})
            try {
              const ready=await send('Runtime.evaluate',{expression:`document.hasFocus() && !!document.querySelector('svg.board-svg')`,returnByValue:true},attached.sessionId)
              if(ready.result?.value) focusedBoard=board.url
            } finally {await send('Target.detachFromTarget',{sessionId:attached.sessionId})}
          }
          }
          const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId).catch(() => null)
          if (shot?.data) writeFileSync(join(out, action.kind + '-workbench.png'), Buffer.from(shot.data, 'base64'))
        }
        for (const context of contexts.get(sessionId) ?? []) {
          const state = await send('Runtime.evaluate', { contextId: context.id, expression: `({href:location.href,viewer:document.getElementById('viewer')?.src,vscode:typeof vscode,focused:document.hasFocus(),active:{tag:document.activeElement?.tagName,id:document.activeElement?.id,cls:document.activeElement?.className,label:document.activeElement?.getAttribute('aria-label')},editors:[...document.querySelectorAll('.monaco-editor')].map(e=>({focused:e.classList.contains('focused'),active:e.contains(document.activeElement)}))})`, returnByValue:true },sessionId)
          inspected.push({target:target.url,context:context.name,state:state.result?.value,error:state.exceptionDetails?.text})
          writeFileSync(join(out,'contexts.json'),JSON.stringify(inspected,null,2))
          const test = await send('Runtime.evaluate', { contextId: context.id, expression: `typeof vscode !== 'undefined' && typeof vscode.postMessage === 'function' && !!document.getElementById('viewer') && document.getElementById('viewer').src.includes('view=2d')`, returnByValue: true }, sessionId)
          if (action.kind.startsWith('diagnostic') || !test.result?.value || !focusedBoard) continue
          if(action.kind==='modal-quickopen') {
            const board=targetInfos.find(t=>t.url===focusedBoard)
            const child=await send('Target.attachToTarget',{targetId:board.targetId,flatten:true})
            const workbench=targetInfos.find(t=>t.type==='page'&&t.url.includes('workbench'))
            const native=await send('Target.attachToTarget',{targetId:workbench.targetId,flatten:true})
            try {
              await send('Runtime.evaluate',{expression:`if(!document.querySelector('[role=dialog]')) window.dispatchEvent(new KeyboardEvent('keydown',{key:'?',code:'Slash',shiftKey:true,bubbles:true,cancelable:true}))`},child.sessionId)
              await new Promise(done=>setTimeout(done,100))
              const modal=await send('Runtime.evaluate',{expression:`!!document.querySelector('[role=dialog]')`,returnByValue:true},child.sessionId)
              await send('Input.dispatchKeyEvent',{type:'keyDown',...inputKey('p', { command: true })},child.sessionId)
              await send('Input.dispatchKeyEvent',{type:'keyUp',...inputKey('p', { command: true })},child.sessionId)
              let quick
              for(let n=0;n<30;n++) {
                quick=await send('Runtime.evaluate',{expression:`(()=>{const e=document.querySelector('.quick-input-widget');return {visible:!!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0,placeholder:e?.querySelector('input')?.placeholder,text:e?.innerText}})()`,returnByValue:true},native.sessionId)
                if(quick.result?.value?.visible) break
                await new Promise(done=>setTimeout(done,100))
              }
              const evidence={kind:action.kind,modal:!!modal.result?.value,quickInput:quick.result?.value,board:focusedBoard}
              const shot=await send('Page.captureScreenshot',{format:'png'},native.sessionId)
              writeFileSync(join(out,'modal-quickopen.png'),Buffer.from(shot.data,'base64'))
              writeFileSync(join(out,'modal-quickopen.json'),JSON.stringify(evidence,null,2))
              await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},native.sessionId)
              await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},native.sessionId)
              await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},child.sessionId)
              await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},child.sessionId)
              if(!evidence.modal||!evidence.quickInput?.visible) evidence.error='Actual modal Mod+P did not open native Quick Input'
              return evidence
            } finally {await send('Target.detachFromTarget',{sessionId:child.sessionId});await send('Target.detachFromTarget',{sessionId:native.sessionId})}
          }
          const keyboard = action.kind === 'pane-undo' || action.kind === 'pane-redo' || action.kind === 'pane-rotate'
          if (keyboard) {
            const board = targetInfos.find(t => t.url === focusedBoard)
            const child = await send('Target.attachToTarget', { targetId: board.targetId, flatten: true })
            try {
              const rotate = action.kind === 'pane-rotate'
              if (rotate) {
                // Pick R1's first copper pad; a plain click selects its Divider group.
                const point = await send('Runtime.evaluate', { expression: `(() => { const content=document.querySelector('svg.board-svg .substrate')?.parentElement; if(!content) return null; const p=new DOMPoint(9.175,7.5).matrixTransform(content.getScreenCTM()); return {x:p.x,y:p.y} })()`, returnByValue:true }, child.sessionId)
                if (!point.result?.value) throw new Error('Rotation canvas is absent')
                const mouse = {...point.result.value,button:'left',clickCount:1}
                await send('Runtime.evaluate', { expression: `window.__pcbjsTestPointer=[]; for (const type of ['pointerdown','pointerup']) document.addEventListener(type,e=>window.__pcbjsTestPointer.push({type,x:e.clientX,y:e.clientY,target:e.target.outerHTML.slice(0,1000)}),{once:true,capture:true})` }, child.sessionId)
                await send('Input.dispatchMouseEvent', {type:'mousePressed',...mouse}, child.sessionId)
                await send('Input.dispatchMouseEvent', {type:'mouseReleased',...mouse}, child.sessionId)
                let selected = false
                for (let n = 0; n < 30 && !selected; n++) {
                  selected = (await send('Runtime.evaluate', { expression: `document.querySelector('.chips-bar')?.textContent.includes('Divider') === true`, returnByValue: true }, child.sessionId)).result?.value === true
                  if (!selected) await new Promise(resolve => setTimeout(resolve, 100))
                }
                if (!selected) {
                  const diagnostic = (await send('Runtime.evaluate', { expression: `({point:${JSON.stringify(point.result.value)},events:window.__pcbjsTestPointer,selection:document.querySelector('.chips-bar')?.textContent,svg:document.querySelector('svg.board-svg')?.outerHTML.slice(0,3000),under:document.elementsFromPoint(${mouse.x},${mouse.y}).map(e=>e.outerHTML.slice(0,700))})`, returnByValue:true },child.sessionId)).result?.value
                  writeFileSync(join(out,'rotation-selection.json'),JSON.stringify(diagnostic,null,2))
                  return { kind: action.kind, error: 'The rotation test did not select the Divider group', diagnostic }
                }
              }
              const key = rotate ? inputKey('r') : inputKey('z', { command: true, shift: action.redo })
              await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key }, child.sessionId)
              await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key }, child.sessionId)
            } finally { await send('Target.detachFromTarget', { sessionId: child.sessionId }) }
          } else {
            const message = { type: 'undo', files: action.files, redo: action.redo }
            const dispatched = await send('Runtime.evaluate', { contextId: context.id, expression: `vscode.postMessage(${JSON.stringify(message)}); true`, returnByValue: true }, sessionId)
            if (dispatched.exceptionDetails) throw new Error(dispatched.exceptionDetails.text)
          }
          let notice = ''
          const workbench = targetInfos.find(t=>t.type==='page'&&t.url.includes('workbench'))
          const native = await send('Target.attachToTarget',{targetId:workbench.targetId,flatten:true})
          try {
            for(let n=0;n<20;n++) {
              const state=await send('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true},native.sessionId)
              notice=state.result?.value??''
              if(!action.kind.includes('multi-document')||notice.includes('this edit spans multiple source documents')) break
              await new Promise(done=>setTimeout(done,100))
            }
            writeFileSync(join(out,action.kind+'-after-text.txt'),notice)
            const shot=await send('Page.captureScreenshot',{format:'png'},native.sessionId)
            writeFileSync(join(out,action.kind+'-after.png'),Buffer.from(shot.data,'base64'))
          } finally {await send('Target.detachFromTarget',{sessionId:native.sessionId})}
          if(action.kind.includes('multi-document')&&!notice.includes('this edit spans multiple source documents')) throw new Error('Installed multi-document explanation not observed')

          return { target: target.url, context: context.name, bridge: keyboard ? (action.kind === 'pane-rotate' ? 'CDP pointer selection and Input.dispatchKeyEvent R in installed viewer' : 'CDP Input.dispatchKeyEvent Mod+Z / Mod+Shift+Z in focused installed viewer') : 'installed webview vscode.postMessage -> undoIn', kind: action.kind, board: focusedBoard, notice: notice.slice(-2000), precondition: 'private workbench raised, visible pane clicked, actual child-board document.hasFocus() true' }
        }
      } catch {}
      finally { if (sessionId) await send('Target.detachFromTarget', { sessionId }).catch(() => {}) }
    }
    if (action.kind.startsWith('diagnostic')) {
      writeFileSync(join(out,action.kind+'-contexts.json'),JSON.stringify(inspected,null,2))
      return {kind:action.kind,contexts:inspected}
    }
    return null
  } finally { rejectPending(); ws.close() }
}
