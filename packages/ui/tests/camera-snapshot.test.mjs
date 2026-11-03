import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { snapshotCamera, restoreCamera } from '../src/scene/camera-snapshot.ts'

const near = (a, b) => assert.ok(a.distanceTo(b) < 1e-10, `${a.toArray()} equals ${b.toArray()}`)
test('camera rollback restores the original pose after successive fits and manual orbit, cancelling pending movement', () => {
  const camera = new PerspectiveCamera(35, 1.6, 0.1, 5000)
  camera.up.set(0, 0, 1)
  camera.position.set(40, -70, 60)
  const controls = new OrbitControls(camera, null)
  controls.target.set(7, -4, 2)
  controls.cursor.set(3, 2, 1)
  controls.enableDamping = true
  controls.update()
  const base = snapshotCamera(camera, controls, 43)
  // Finding A, then B, then the user pans/orbits while still focused.
  for (const [x, y, z] of [[2, 4, 12], [18, -3, 20], [22, -8, 9]]) {
    camera.position.set(x, y, z)
    controls.target.set(x / 3, y / 3, 0)
    controls.update()
  }
  camera.near = 0.01
  camera.far = 300
  camera.zoom = 2
  camera.fov = 50
  // Residual inertia from a real OrbitControls interaction must not survive rollback.
  controls._sphericalDelta.theta = 0.4
  controls._panOffset.set(2, -1, 4)
  let springActive = true, stackActive = true, pendingNearFar = [0.01, 300]
  const radius = restoreCamera(camera, controls, base, () => {
    springActive = stackActive = false
    pendingNearFar = null
  })
  assert.equal(springActive, false)
  assert.equal(stackActive, false)
  assert.equal(pendingNearFar, null)
  assert.equal(radius, 43)
  for (let i = 0; i < 20; i++) controls.update()
  near(camera.position, base.position)
  near(controls.target, base.target)
  near(controls.cursor, base.cursor)
  near(camera.up, base.up)
  assert.ok(1 - Math.abs(camera.quaternion.dot(base.quaternion)) < 1e-12)
  for (const key of ['near', 'far', 'zoom', 'fov']) assert.equal(camera[key], base[key])
  assert.equal(controls.enableDamping, true)
})

test('snapshots own their vectors and cannot follow later camera or controls mutations', () => {
  const camera = new PerspectiveCamera()
  camera.position.set(3, 4, 5)
  const controls = new OrbitControls(camera, null)
  const original = camera.position.clone()
  const base = snapshotCamera(camera, controls, 10)
  camera.position.set(50, 60, 70)
  controls.target.set(4, 5, 6)
  controls.cursor.set(7, 8, 9)
  near(base.position, original)
  assert.deepEqual(base.target.toArray(), [0, 0, 0])
  assert.deepEqual(base.cursor.toArray(), [0, 0, 0])
})

test('3D blur uses the orbit springs, lands exactly, and yields to new focus or manual input', async () => {
  const { readFileSync } = await import('node:fs')
  const { transpileModule } = await import('typescript')
  const THREE = await import('three')
  const { Spring } = await import('../src/scene/motion.ts')
  const { StackFit } = await import('../src/scene/stack-fit.ts')
  const source = readFileSync(new URL('../src/Canvas3D.vue', import.meta.url), 'utf8')
  const motion = source.slice(source.indexOf('// critically damped:'), source.indexOf('/** Frame the current layout'))
  const restore = source.slice(source.indexOf('const cameraPose ='), source.indexOf('const frameActive ='))
  const interrupt = /controls.addEventListener\('start', \(\) => \{([\s\S]*?)\n  \}\)/.exec(source)[1]
  const js = transpileModule(`${motion}\n${restore}`, { compilerOptions: { target: 99 } }).outputText
  const camera = new PerspectiveCamera(35, 1.6, 0.1, 5000)
  camera.up.set(0, 0, 1)
  camera.position.set(50, -70, 60)
  const controls = new OrbitControls(camera, null)
  controls.target.set(4, -2, 1)
  controls.enableDamping = true
  controls.update()
  const base = snapshotCamera(camera, controls, 40)
  const run = new Function('THREE', 'Spring', 'StackFit', 'snapshotCamera', 'restoreCamera', 'camera', 'controls', `let fitRadius=40,dirty=false,fitted=true,cameraHadFocus=false,lastFrameKey='',lastFindingKey='',reduce=false; const reduced=()=>reduce; ${js}; return { move:moveCamera, restore:restorePose, pose:cameraPose, step:()=>{stepCamera(1/60);controls.update()}, moving:()=>camMoving, interrupt:()=>{${interrupt}}, reduce:()=>reduce=true }`)(THREE, Spring, StackFit, snapshotCamera, restoreCamera, camera, controls)
  const settle = () => { for (let i=0; i<240; i++) run.step(); assert.equal(run.moving(), false) }
  const focus = () => run.move(new THREE.Vector3(10, -3, 2), new THREE.Vector3(-1, 1, 1).normalize(), 15, 0.01, 500)
  focus(); settle()
  camera.zoom = 1.4
  camera.fov = 40
  controls.cursor.set(9, 2, 5)
  const focused = snapshotCamera(camera, controls, 10)
  controls._sphericalDelta.theta = 0.4
  controls._panOffset.set(2, -1, 4)
  run.restore(base, true)
  near(camera.position, focused.position)
  near(run.pose().position, base.position, 'a refocus or remount checkpoints the return destination')
  assert.equal(run.moving(), true)
  run.step()
  assert.ok(camera.position.distanceTo(focused.position) > 0.001)
  assert.ok(camera.position.distanceTo(base.position) > 0.001, 'blur does not snap to the destination')
  assert.ok(camera.zoom < focused.zoom && camera.zoom > base.zoom)
  settle()
  near(camera.position, base.position)
  near(controls.target, base.target)
  near(controls.cursor, base.cursor)
  assert.ok(1 - Math.abs(camera.quaternion.dot(base.quaternion)) < 1e-12)
  for (const key of ['near', 'far', 'fov', 'zoom']) assert.equal(camera[key], base[key])
  focus(); run.step(); run.restore(base, true); settle()
  near(camera.position, base.position, 'canceling an unfinished focus returns to the checkpoint')
  focus(); settle(); run.restore(base, true); run.step(); focus(); settle()
  assert.ok(camera.position.distanceTo(base.position) > 1, 'new focus supersedes the old rollback')
  run.restore(base, true); run.step(); run.interrupt()
  const manual = camera.position.clone()
  settle(); near(camera.position, manual)
  run.reduce(); run.restore(base, true)
  near(camera.position, base.position)
  assert.equal(run.moving(), false, 'reduced motion restores immediately')
})

test('Canvas3D framing transaction keeps A→B and manual motion under one rollback, including nested frame cancellation', async () => {
  const { readFileSync } = await import('node:fs')
  const { transpileModule } = await import('typescript')
  const { focusTransaction, cancelFocus } = await import('../src/focus-transaction.ts')
  const source = readFileSync(new URL('../src/Canvas3D.vue', import.meta.url), 'utf8')
  const block = source.slice(source.indexOf('const cameraTransaction ='), source.indexOf('// px: a marker'))
  const js = transpileModule(block, { compilerOptions: { target: 99 } }).outputText
  const lateFit = /built\.refs\?\.then\(\(\) => \{\n([\s\S]*?)\n  \}\)/.exec(source)[1]
  const camera = new PerspectiveCamera(35, 1.5, 0.1, 5000)
  camera.up.set(0, 0, 1)
  camera.position.set(40, -30, 60)
  const controls = new OrbitControls(camera, null)
  const base = snapshotCamera(camera, controls, 50)
  const props = { board: { name: 'A' }, finding: null, frameRef: null, frameArea: null, iso: null }
  const ctx = { pane: { focusViews: new Map() } }
  const notes = { value: [{ id: 'A', layer: 'F.Cu', side: 'F' }, { id: 'B', layer: 'F.Cu', side: 'F' }] }
  const THREE = await import('three')
  let moves = 0, midpointReady = true
  const frameNow = () => { camera.position.set(10, -10, 20); moves++; return true }
  const create = () => new Function('focusTransaction', 'snapshotCamera', 'restoreCamera', 'ctx', 'props', 'keyOfSite', 'camera', 'controls', 'notes', 'notePoint', 'pcb', 'THREE', 'moveCamera', 'frameNow', `let fitRadius=50, dirty=false, camMoving=false, camNearFar=null, camRestore=null, fitted=true; const reduced=()=>true; const stackFit={stop(){}}; const FOCUS_DIR=[1,-1,1], FOCUS_BELOW=[1,1,-1]; ${js}; return {lateFit: () => { const fresh=true, my=1, alive=true; pcb.gen=1; const view=frameNow, firstView=()=>'iso'; ${lateFit} }, sync: syncCameraFocus, save: () => cameraTransaction().save(cameraPose()), mount: () => { const saved = cameraTransaction().current(); if (saved) { restorePose(saved); lastFrameKey = saved.frameKey ?? ''; lastFindingKey = saved.findingKey ?? ''; } syncCameraFocus(); }}`)(focusTransaction, snapshotCamera, restoreCamera, ctx, props, b => b.name, camera, controls, notes, () => midpointReady ? new THREE.Vector3(1, 2, 3) : null, { root: { localToWorld: p => p } }, THREE, (centre, dir, dist) => { camera.position.copy(centre).addScaledVector(dir, dist); moves++ }, frameNow)
  let view = create()
  const sync = () => view.sync()
  props.frameRef = 'R1'
  sync()
  const framePose = snapshotCamera(camera, controls, 50)
  props.finding = 'A'; sync()
  props.finding = 'B'; sync()
  camera.position.set(90, 100, 110) // manual orbit never replaces the checkpoint
  view.save()
  props.finding = null
  cancelFocus(ctx.pane.focusViews, ['frame'])
  view = create()
  view.mount()
  near(camera.position, framePose.position)
  assert.equal(moves, 3, 'finding cancellation restores the unchanged frame without another fit')
  props.frameRef = null; sync()
  near(camera.position, base.position)
  view.save()
  view = create()
  view.mount()
  const beforeLateFit = moves
  view.lateFit()
  assert.equal(moves, beforeLateFit, 'late referenced-model completion cannot overwrite a restored base on remount')
  near(camera.position, base.position)
  assert.equal(ctx.pane.focusViews.get('A:3d').frames.length, 0)
  props.finding = 'A'; sync()
  notes.value = notes.value.map(n => n.id === 'A' ? { ...n, layer: 'sch' } : n)
  sync()
  near(camera.position, base.position)
  assert.equal(ctx.pane.focusViews.get('A:3d').frames.length, 0, 'a still-canonical finding without a relevant 3D mark cancels its camera transaction')
  assert.match(source, /props\.iso, props\.fromBelow, props\.board\]/)
  props.finding = null; sync()
  notes.value = notes.value.map(n => ({ ...n, layer: 'F.Cu' }))
  props.finding = 'A'; sync()
  assert.deepEqual(ctx.pane.focusViews.get('A:3d').frames.map(f => f.kind), ['finding'])
  props.frameRef = 'R2'; sync()
  assert.deepEqual(ctx.pane.focusViews.get('A:3d').frames.map(f => f.kind), ['frame', 'finding'], 'entering a frame after a finding rebases checkpoint order')
  const framed = ctx.pane.focusViews.get('A:3d').frames[1].value
  props.finding = null; sync()
  near(camera.position, framed.position)
  assert.deepEqual(ctx.pane.focusViews.get('A:3d').frames.map(f => f.kind), ['frame'])
  props.frameRef = null; sync()
  near(camera.position, base.position)
  midpointReady = false
  props.finding = 'B'
  const beforeMidpoint = moves
  sync()
  assert.equal(moves, beforeMidpoint)
  midpointReady = true
  sync()
  assert.equal(moves, beforeMidpoint + 1, 'initial line focus retries once its midpoint is built')

})

test('initial exploded mount settles the requested stack before its single board/focus fit', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../src/Canvas3D.vue', import.meta.url), 'utf8')
  const start = source.indexOf('  // Build and fit once in the requested stack state')
  const mount = source.slice(start, source.indexOf('  raf = requestAnimationFrame(loop)', start))
  const calls = []
  const spring = { value: 0, snap(n) { this.value = n } }
  const run = new Function('sepSpring', 'sepTarget', 'calls', `let sepNow=0; const syncCameraFocus=()=>{}, setBoard=()=>calls.push(['fit',sepNow]), markPoints=()=>{}, buildLinks=()=>{}, drawDots=()=>{}, drawTools=()=>{}; ${mount}; return sepNow`)
  assert.equal(run(spring, () => 7, calls), 7)
  assert.deepEqual(calls, [['fit', 7]], 'no whole-board reset may overwrite the active finding after initial framing')
})

test('target replacement saves the departing scope before camera state is reset', async () => {
  const { readFileSync } = await import('node:fs')
  const { transpileModule } = await import('typescript')
  const { focusTransaction } = await import('../src/focus-transaction.ts')
  const source = readFileSync(new URL('../src/Canvas3D.vue', import.meta.url), 'utf8')
  const start = source.indexOf('    if (keyOfSite(now) !== keyOfSite(was)) {')
  const block = source.slice(start, source.indexOf('    setBoard(was)', start))
  const js = transpileModule(block, { compilerOptions: { target: 99 } }).outputText
  const slots = new Map()
  const camera = new PerspectiveCamera()
  camera.position.set(12, -8, 40)
  const controls = new OrbitControls(camera, null)
  const run = new Function('focusTransaction', 'ctx', 'keyOfSite', 'now', 'was', 'camera', 'cameraPose', `let fitted=true,camMoving=true,camNearFar=[1,2],camRestore=null,lastFrameKey='old',lastFindingKey='old',cameraHadFocus=true; const stackFit={stop(){}}; ${js}; return fitted`)
  assert.equal(run(focusTransaction, { pane: { focusViews: slots } }, b => b.name, { name: 'B' }, { name: 'A' }, camera, () => snapshotCamera(camera, controls, 20)), false)
  near(focusTransaction(slots, 'A', '3d').current().position, camera.position)
  assert.equal(focusTransaction(slots, 'B', '3d').current(), undefined)
})
