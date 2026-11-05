<script setup lang="ts">
import { displayRef } from './refs'
import Bubble from './Bubble.vue'
// The 3D view: the renderer, the camera and its controls, the frame loop, the DOM overlays and the binding of the props to a Paint. The
// board itself is ./scene/board-scene; one three.js unit is a millimetre, board (x, y) is three (x, -y), z up.
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { usePinch } from './touch'
import { pointerInside, usePointer } from './pointer'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { SiteData, SiteFootprint } from '@pcbjs/core/site-data'
import { keyOfSite, NONE, type Stale } from './live'
import { focusTransaction, type FocusKind } from './focus-transaction'
import { snapshotCamera, restoreCamera, type CameraSnapshot } from './scene/camera-snapshot'
import { describe, generatedModel, markingFor } from './models'
import { isGenerated } from '@pcbjs/core/internal/model-source'
import { modelChoice } from './models/choice'
import { stepModel } from './models/step'
import { missingModel } from './models/missing'
import { referenceGroup, referenceUrl } from './scene/reference'
import { appBase, assetUrl } from './variants'
import { env } from './env'
import { injectPane, modsOf, useCommands } from './context'
import { GeometryCache, type ItemInfo } from './scene/items'
import { GeometryPool } from './scene/geometry'
// inlined, so the library works wherever a bundler moves its chunks
import GeometryWorker from './scene/geometry.worker.ts?worker&inline'
import { LOOK } from './scene/highlight'
import { Outline, type OutlineState, type OutlineStyle } from './scene/outline'
import { invertMat, type Drawn, type Hit, type IsolationView, type Mods, type Selection } from './selection'
import { hoverLit, paintOf, useHover, type Paint } from './paint'
import { FOCUS_DIR, ISO_DIR, SUN, UNDER } from './scene/lights'
// FOCUS_DIR mirrored under the board, from the north so the back reads left to right as in the bottom view
const FOCUS_BELOW: [number, number, number] = [FOCUS_DIR[0], -FOCUS_DIR[1], -FOCUS_DIR[2]]
import { Spring } from './scene/motion'
import { Grid } from './scene/grid'
import { fitBeside, fitDistance, fitSphere } from './scene/fit'
import { StackFit, poseOf, positionOf } from './scene/stack-fit'
import { gridStep } from './grid'
import { routeHover } from './routes'
import { setPainted, setReady } from './ready'
import type { Stack } from './indicators'
import { changedFacets } from './scene/remake'
import { endIds, endLines, endMarks3d, endsOf, litEnd, nearestEnd, pickEnd } from './ends'
import { onPlane, useTools3d } from './tools3d'
import type { ToolHit } from './gesture'
import { ToolLayer, type ToolColors } from './scene/tools'
import { toolHitOf } from './scene/pick'
import { BoardScene, type ScenePick } from './scene/board-scene'
import { Links } from './scene/links'
import { StackLabels } from './scene/stack-labels'
import EditBar from './EditBar.vue'
import {
  BROKEN_ICON,
  DOT,
  dotLook,
  dotShape,
  dotTitle,
  dotUnder,
  findingDots,
  findingLines,
  findingNotes,
  noteShown,
  ratsZoom,
  shownLines,
  spread,
  type FindingNote,
  type LabelBox,
} from './finding-marks'
import { FindingDots } from './scene/finding-dots'

type Picked = { ref?: string; id: number | null; kind: string; net?: string }

const props = withDefaults(
  defineProps<{
    board: SiteData
    hidden: Set<string>
    sel: Selection
    /** what the selection draws on this board */
    drawn?: Drawn | null
    /** what an isolation shows; the rest hidden, or faded for a single instance */
    iso?: IsolationView | null
    /** a net hovered in a side panel, outlined as a hover without the focus fade */
    hoverNet?: string | null
    /** the parts of the circuit instance hovered in the side panel */
    hoverRefs?: readonly string[]
    fade?: boolean
    explode?: boolean
    separation?: number
    /** a part to frame at once, as ?select= asks */
    frameRef?: string | null
    /** an area to frame in board mm, x, y, width and height, when no part is framed, as an isolation asks */
    frameArea?: [number, number, number, number] | null
    /** open on the bottom, as ?side=B asks */
    fromBelow?: boolean
    /** what the last edit made stale: see-through and never picked until its stage ends */
    stale?: Stale
    /** the finding in focus, ringed */
    finding?: string | null
    /** the DRC tab is open: every ratsnest line shows its label */
    review?: boolean
  }>(),
  { fade: undefined, explode: undefined, separation: undefined },
)
const emit = defineEmits<{
  pick: [Hit | null, Mods]
  /** a finding's marker or line label clicked, by exact id */
  finding: [string, Mods]
  enter: [Hit | null]
  net: [string | null]
  hover: [(Picked & { layer: string }) | null]
  'update:fade': [boolean]
  'update:explode': [boolean]
  'update:separation': [number]
}>()

const ctx = injectPane()!
const { board: viewer, prefs: page } = ctx
const toggleGrid = () => ctx.toggle('grid')
const toggleRatsnest = () => ctx.toggle('ratsnest')
// a route end slot: each open end labelled over its copper and outlined, and a click on one fills the slot
const ends = computed(() => endsOf(viewer.edit, props.board, props.sel.isolate))
const endLayer = ref<HTMLDivElement | null>(null)
/** the label under the pointer, else the editor's completion focus, lit as a hover */
const endPointer = ref<string | null>(null)
const endHover = computed(() => {
  const e = ends.value
  return e ? (litEnd(viewer.edit, e, e.ends.candidates.find(c => c.handle === endPointer.value) ?? null)?.handle ?? null) : null
})
const endMarks = computed(() => {
  const e = ends.value
  if (!e) return []
  void props.board
  return endMarks3d(e, { F: pcb.slices.get('F.Cu')?.z1 ?? props.board.thickness, B: pcb.slices.get('B.Cu')?.z0 ?? 0 })
})
// the findings: one drawn as a ratsnest line or failed leg carries its label at the line's middle, every other one is a dot at its spot
const findLines = computed(() => findingLines(props.board))
const isStale = (id: string) => !!id && !!props.stale?.findings.has(id)
const isShown = (id: string) => !props.iso || (!!id && props.iso.findings.has(id))
const notes = computed(() => findingNotes(props.board, findLines.value).filter(n => isShown(n.id)))
// a line's label shows in the DRC tab, else only on the line hovered, or the one holding the focused or selected finding
const hoverLine = ref<number | null>(null)
const labelLines = computed(() => shownLines(findLines.value, { review: !!props.review, hover: hoverLine.value, ids: new Set([props.finding ?? '', ...props.sel.refs]) }))
// the labels of the lines shown; the dots carry no label, their tooltip names the one under the pointer
const visibleNotes = computed(() => notes.value.filter(n => n.line !== null && noteShown(n, labelLines.value)))
const dotNotes = computed(() => findingDots(notes.value))
const dotHover = ref<number | null>(null)
const dotTipAt = ref<[number, number] | null>(null)
const dotTip = computed(() => {
  const n = dotHover.value === null ? null : dotNotes.value[dotHover.value]
  return n ? { text: dotTitle(n), severity: n.severity } : null
})
const noteLayer = ref<HTMLDivElement | null>(null)
const noteHover = ref<string | null>(null)
/** A label under the pointer: hovered, and its line stays lit while the pointer is on the label. */
function onNote(n: FindingNote) {
  noteHover.value = n.key
  if (n.line !== null) hoverLine.value = n.line
}
const host = ref<HTMLDivElement>()
const hover = ref<{ title: string; value: string; detail: string; x: number; y: number; item: ItemInfo | null; ref?: string } | null>(null)
// fade, explode and separation follow their props when given, else what this browser remembers
const ui = reactive({ fade: props.fade ?? true, explode: props.explode ?? false, separation: props.separation ?? 4 })
const fadeOn = computed(() => ui.fade)
/** how the content out of a focus is drawn, remembered by this browser */
const look = reactive({ ...LOOK })
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private mode */
    }
  },
}

let renderer: THREE.WebGLRenderer | null = null
let callLayer: HTMLDivElement | null = null
let envMap: THREE.Texture | null = null
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls
const hoverLayer = ref<string | null>(null)
const geoCache = new GeometryCache()
const pool = new GeometryPool(() => new GeometryWorker(), Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) - 1)))
let alive = true
// readySent once per build and per explode change, paintSent once per build
let readySent = false,
  paintSent = false
const grid = new Grid()
let gridBaseZ = 0
let outline: Outline | null = null
let dirty = true,
  // only the outlined set or a dot's size changed: the frame draws again over the scene depth the outline kept
  hoverDirty = false,
  raf = 0,
  fitted = false
let ro: ResizeObserver | null = null,
  mo: MutationObserver | null = null,
  mq: MediaQueryList | null = null
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2()
let downAt: [number, number] | null = null

function cssColor(name: string, fallback: string) {
  const v = host.value ? getComputedStyle(host.value).getPropertyValue(name).trim() : ''
  try {
    return new THREE.Color(v || fallback).getStyle()
  } catch {
    return fallback
  }
}
/** A part's model at its origin: a box is no model, drawn as its outline with the ref, made per part so it goes with the board. */
function bodyOf(fp: SiteFootprint, b: SiteData, track: <T extends { dispose(): void }>(d: T) => T): THREE.Object3D {
  const spec = modelChoice(fp)
  if (!spec) return new THREE.Group()
  if (isGenerated(spec)) return generatedModel(spec, { height: fp.height, thickness: b.thickness }, markingFor(spec, { value: fp.value, fields: fp.fields ?? {} }))
  const model = spec.kind === 'box' ? missingModel(spec.w, spec.h, spec.height, fp.ref) : missingModel(fp.body.w, fp.body.h, fp.height, fp.ref)
  model.traverse(o => {
    const m = o as THREE.Mesh
    if (m.geometry) track(m.geometry)
    const map = (m.material as THREE.MeshBasicMaterial | undefined)?.map
    if (map) {
      track(map)
      track(m.material as THREE.Material)
    }
  })
  return model
}
const pcb = new BoardScene({
  css: cssColor,
  cache: geoCache,
  pool,
  body: bodyOf,
  step: (fp, face, b) => stepModel(fp.ref, fp.step!, fp, face, !!b.dev),
  reference: (r, b) =>
    referenceGroup(
      r,
      referenceUrl(r.mesh!, !!b.dev, p => assetUrl(p, appBase(env.base, location.pathname))),
    ),
  changed: () => (dirty = true),
  meshed: () => warmPicks(pcb.gen),
})
// models are shared from the module cache in ./models, never disposed here
const links = new Links(cssColor)
let stack: StackLabels | null = null

// the editing tools and the assist mode as in 2D, on the plane of the part's side or the route's layer; a press they take keeps the camera
const pxMm = shallowRef(0.05)
const tt = useTools3d({
  board: () => props.board,
  sel: () => props.sel,
  drawn: () => props.drawn ?? null,
  store: viewer,
  planeAt: (e, layer) => planeAt(e, layer),
  px: () => pxMm.value,
})
let tools: ToolLayer | null = null
let toolPress = false
function onOptionKey(e: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
  const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]')]
  const current = buttons.indexOf(e.target as HTMLButtonElement)
  const index = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
  e.preventDefault()
  buttons[index]?.focus()
  buttons[index]?.click()
}
const chipAt = ref<[number, number] | null>(null)
const chipStyle = computed(() => {
  const c = chipAt.value
  return c ? { x: c[0], y: c[1] } : { x: 8, y: 78 }
})

/** The board data in the scene: a new board builds it again, new footprints only the bodies, anything else nothing. */
function setBoard(was: SiteData | undefined) {
  const built = pcb.setFacets(props.board, changedFacets(was, props.board))
  if (!built) {
    if (tt.pose.value) drawPose()
    dirty = true
    return
  }
  localHover.value = null
  hover.value = null
  hoverLayer.value = null
  readySent = paintSent = false
  stack?.build(pcb.callouts, pcb.planes, pcb.groups, pcb.hull, pcb.rings)
  // the first fit frames the references once they land
  const fresh = !fitted,
    my = pcb.gen
  built.refs?.then(() => {
    if (fresh && my === pcb.gen && alive && !cameraHadFocus && !frameActive() && !focusedNote()) view(firstView())
  })
  // the first paint whole, a later one as its difference from what the build repainted
  applyPaint()
  placeFrame()
  updateLabels()
  dirty = true
  if (!fitted) {
    view(firstView())
    fitted = true
    const saved = cameraTransaction().current()
    if (saved) {
      restorePose(saved)
      lastFrameKey = saved.frameKey ?? ''
      lastFindingKey = saved.findingKey ?? ''
    }
    syncCameraFocus()
  }
}

// what the view draws for the selection, the hover, the isolation and the edit, applied to the scene as its difference from the last
const hoverL = computed(() =>
  hoverLit(props.board, props.sel, hoverRef.value, {
    remote: viewer.remote?.board === props.board.name ? viewer.remote.hover : null,
    net: props.hoverNet,
    refs: props.hoverRefs,
  }),
)
const paint = computed(() => paintOf(props.board, props.drawn ?? null, hoverL.value, props.iso ?? null, props.stale, props.hidden, fadeOn.value))
const focusOn = computed(() => paint.value.fade)
let painted: Paint | null = null
function applyPaint() {
  const p = paint.value
  const r = pcb.paint(p, painted)
  painted = p
  if (r === 'outline') hoverDirty = true
  else if (r === 'scene') {
    updateLabels()
    dirty = true
  }
}
// the outline follows the scene's outlined sets whenever they are new
let outlined: Record<OutlineState, THREE.Mesh[]> | null = null
function syncOutline() {
  if (!outline || pcb.outlines === outlined) return
  outlined = pcb.outlines
  outline.set(outlined)
}
let seeOf: readonly THREE.Object3D[] | null = null,
  seeAll: THREE.Object3D[] = []
const seeThrough = () => (pcb.seeThrough === seeOf ? seeAll : (seeAll = [...(seeOf = pcb.seeThrough), grid.root]))

// the findings' dots: one instanced draw, their screen positions found again only for a pointer test after the camera or the dots moved
const dotLayer = new FindingDots()
let dotXY: Float32Array | null = null
const SEVERITY_TOKEN: Record<string, string> = { error: '--drc-err', warning: '--drc-warn', info: '--drc-info' }
const sevColor = (severity: string) => new THREE.Color().setStyle(cssColor(SEVERITY_TOKEN[severity] ?? '--drc-warn', '#ff9f1c'), THREE.LinearSRGBColorSpace)
const dotState = (n: FindingNote, i: number) => ({ stale: isStale(n.id), focus: !!n.id && n.id === props.finding, hover: i === dotHover.value, out: false })
const notePt = new THREE.Vector3()
/** The board-group point a note hangs from: its line's middle, else its spot on its layer, the layer's explode offset included. */
function notePoint(n: FindingNote): THREE.Vector3 | null {
  if (n.line !== null) {
    const m = links.mids.get(n.line)
    return m ? notePt.copy(m) : null
  }
  return notePt.set(n.at[0], -n.at[1], pcb.markZ(pcb.marked(n.layer) ? n.layer : `${n.side}.Cu`))
}
/** Every dot at its spot on its layer, the layer's explode offset included. */
function drawDots() {
  if (!pcb.board) return
  const colors = new Map<string, THREE.Color>()
  const color = (sev: string) => colors.get(sev) ?? colors.set(sev, sevColor(sev)).get(sev)!
  const draws = dotNotes.value.map((n, i) => {
    const p = notePoint(n)!
    return { at: [p.x, -p.y, p.z] as [number, number, number], color: color(n.severity), shape: dotShape(n), ...dotLook(dotState(n, i)) }
  })
  dotLayer.set(draws, renderer?.getPixelRatio() ?? 1)
  if (dotLayer.mesh.parent !== pcb.root) pcb.root.add(dotLayer.mesh)
  dotXY = null
  dirty = true
}
/** The dot under a pointer, by its index in dotNotes, one test on the whole set. */
function dotAt(e: { clientX: number; clientY: number }): number | null {
  if (!renderer || !pcb.board || !dotLayer.mesh.count) return null
  const r = renderer.domElement.getBoundingClientRect()
  dotXY ??= dotLayer.screen(pcb.root.matrixWorld, camera, r.width, r.height)
  return dotUnder(dotXY, [e.clientX - r.left, e.clientY - r.top], DOT.hit)
}
/** The dot under the pointer drawn larger with its tooltip beside it; the one it leaves back at rest. */
function setDotHover(i: number | null, at: [number, number] | null) {
  dotTipAt.value = i === null ? null : at
  if (dotHover.value === i) return
  const prev = dotHover.value
  dotHover.value = i
  const ratio = renderer?.getPixelRatio() ?? 1
  for (const k of [prev, i]) {
    const n = k === null ? null : dotNotes.value[k]
    if (n === null || k === null) continue
    const l = dotLook(dotState(n, k))
    dotLayer.restyle(k, l.size, l.alpha, ratio)
  }
  hoverDirty = true
}
/** A dot clicked: the finding takes the focus, the chip and its tab, and the camera frames it as it frames a part. */
function clickDot(i: number, e: PointerEvent) {
  const n = dotNotes.value[i]
  if (!n?.id || !pcb.board) return
  emit('finding', n.id, modsOf(e))
}

type SavedCamera = CameraSnapshot & { frameKey?: string; findingKey?: string }
const cameraTransaction = () => focusTransaction<SavedCamera>(ctx.pane.focusViews, keyOfSite(props.board), '3d')
const cameraPose = (): SavedCamera => ({ ...(camRestore ?? snapshotCamera(camera, controls, fitRadius)), frameKey: lastFrameKey, findingKey: lastFindingKey })
function restorePose(pose: CameraSnapshot, animate = false) {
  // A saved or queued rollback also owns the camera when no focus remains on remount.
  cameraHadFocus = true
  const moving = animate && !reduced()
  fitRadius = restoreCamera(camera, controls, moving ? snapshotCamera(camera, controls, fitRadius) : pose, () => {
    camMoving = false
    camRestore = null
    stackFit.stop()
    camNearFar = null
  })
  if (moving) {
    const offset = pose.position.clone().sub(pose.target)
    moveCamera(pose.target, offset.clone().normalize(), offset.length(), pose.near, pose.far)
    cam.fov.set(pose.fov)
    cam.zoom.set(pose.zoom)
    camRestore = pose
  }
  dirty = true
}
const frameActive = () => !!(props.frameRef || props.frameArea || props.iso)
const focusedNote = () => notes.value.find(n => n.id === props.finding && n.layer !== 'sch')
let lastFrameKey = '',
  lastFindingKey = '',
  cameraHadFocus = false
/** Cancel before fitting: clearing a nested finding restores its frame without refitting it. */
function syncCameraFocus(force = false) {
  if (!camera || !fitted) return
  const transaction = cameraTransaction()
  const n = focusedNote()
  const kinds: FocusKind[] = []
  if (frameActive()) kinds.push('frame')
  if (n) kinds.push('finding')
  if (kinds.length) cameraHadFocus = true
  const frameKey = frameActive() ? JSON.stringify([keyOfSite(props.board), props.frameRef, props.frameArea, props.iso?.frame, props.fromBelow]) : ''
  const findingKey = n ? `${keyOfSite(props.board)}:${n.id}` : ''
  transaction.cancel(kinds)
  // A frame entered or changed beneath a finding must own the outer checkpoint.
  // Roll back the old finding before fitting and checkpointing the new frame.
  if (frameKey && frameKey !== lastFrameKey) transaction.cancel(['frame'])
  const restore = transaction.takeRestore()
  const refit = (frameKey && (force || frameKey !== lastFrameKey)) || (n && (force || findingKey !== lastFindingKey || frameKey !== lastFrameKey))
  if (restore) restorePose(restore, !refit)
  if (frameKey && (force || frameKey !== lastFrameKey)) {
    transaction.begin('frame', cameraPose())
    frameNow()
  }
  if (n && (force || findingKey !== lastFindingKey || frameKey !== lastFrameKey)) {
    const p = notePoint(n)
    if (p) {
      transaction.begin('finding', cameraPose())
      const centre = pcb.root.localToWorld(p.clone())
      const dir = new THREE.Vector3(...(n.side === 'B' ? FOCUS_BELOW : FOCUS_DIR)).normalize()
      moveCamera(centre, dir, 20, 0.1, 4000)
      lastFindingKey = findingKey
    }
  }
  lastFrameKey = frameKey
  if (!n) lastFindingKey = ''
}
// px: a marker's label sits this far up and right of it, labels keep this gap, a character of the 11 px mono label is about this wide
const LIFT: [number, number] = [14, 14],
  NOTE_GAP = 2,
  CHAR = 6.7,
  NOTE_H = 15
/** Per drawn frame: each note's ring at its spot on screen and its label beside it on a leader, labels moved apart where they would touch. */
function layoutNotes() {
  const box = noteLayer.value
  if (!box || !renderer || !pcb.board) return
  const el = renderer.domElement,
    w = el.clientWidth,
    h = el.clientHeight
  const btns = box.querySelectorAll<HTMLElement>('.view3d-note'),
    leads = box.querySelectorAll<SVGPathElement>('.view3d-note-leads path')
  const shown: number[] = [],
    boxes: LabelBox[] = []
  visibleNotes.value.forEach((n, i) => {
    const p = notePoint(n)
    if (p) pcb.root.localToWorld(p).project(camera)
    const out = !p || p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2
    if (btns[i]) btns[i].style.display = out ? 'none' : ''
    if (leads[i]) leads[i].style.display = out ? 'none' : ''
    if (out) return
    shown.push(i)
    boxes.push({ at: [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h], w: n.text.length * CHAR + (n.broken ? 15 : 0) + 8, h: NOTE_H, centre: n.line !== null })
  })
  const tl = spread(boxes, LIFT, NOTE_GAP)
  shown.forEach((i, k) => {
    const [ax, ay] = boxes[k].at,
      ly = tl[k][1]
    const lx = tl[k][0]
    const b = btns[i]
    if (!b) return
    b.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px)`
    ;(b.lastElementChild as HTMLElement).style.transform = `translate(${(lx - ax).toFixed(1)}px, ${(ly - ay).toFixed(1)}px)`
    leads[i]?.setAttribute('d', boxes[k].centre ? '' : `M${ax.toFixed(1)} ${ay.toFixed(1)}L${lx.toFixed(1)} ${(ly + NOTE_H).toFixed(1)}`)
  })
}

// the ratsnest, the selection's connections and the finding lines, rebuilt when the selection, the board or the explode changes
const ratsZoomNow = () => {
  const el = renderer?.domElement
  const bb = props.board.bbox
  return el ? ratsZoom(pxPerMm(), Math.max(bb.w, bb.h), Math.min(el.clientWidth, el.clientHeight)) : 1
}
const linkScale = () => ({ zoom: ratsZoomNow(), mmPx: 1 / pxPerMm(), ratio: renderer?.getPixelRatio() ?? 1 })
function linkStack(): Stack {
  const z = (l: string) => {
    const s = pcb.slices.get(l)
    return s ? (s.z0 + s.z1) / 2 + pcb.offset(l) : 0
  }
  return { z, top: (pcb.slices.get('F.Cu')?.z1 ?? props.board.thickness) + pcb.offset('F.Cu'), bottom: (pcb.slices.get('B.Cu')?.z0 ?? 0) + pcb.offset('B.Cu') }
}
const lineFocus = (i: number) => labelLines.value.has(i) && !props.review
function buildLinks() {
  if (!pcb.board || !camera) return
  links.build(
    pcb.root,
    {
      board: props.board,
      // a route end slot shows the ratsnest whatever the toggle: the first end's net lit, every other line dimmed
      ends: ends.value ? endLines(props.board, ends.value) : null,
      lines: findLines.value,
      ratsnest: page.ratsnest,
      drawn: props.drawn ?? null,
      stack: linkStack(),
      shown: isShown,
      stale: isStale,
      focus: lineFocus,
    },
    linkScale(),
  )
  dirty = true
}
function restyleLinks() {
  links.restyle({ lines: findLines.value, stale: isStale, focus: lineFocus })
  dirty = true
}
/** The finding line under the pointer, by its index in findLines; the raycaster set from the camera already. */
const lineUnder = () => links.under(raycaster)

let marks: THREE.Group | null = null
function markPoints() {
  if (marks) {
    marks.parent?.remove(marks)
    for (const c of marks.children) {
      const m = c as THREE.Mesh
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    marks = null
  }
  const pts = props.drawn?.points ?? []
  if (!pcb.board || !pts.length) {
    dirty = true
    return
  }
  marks = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color: cssColor('--accent', '#6ea8ff'), side: THREE.DoubleSide, depthTest: false, transparent: true })
  const z = props.board.thickness + 0.1
  for (const [x, y] of pts) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), mat.clone())
    m.position.set(x, -y, z)
    m.renderOrder = 7
    m.userData.pick = false
    marks.add(m)
  }
  mat.dispose()
  pcb.root.add(marks)
  dirty = true
}

let sepNow = 0
const sepSpring = new Spring(0, { response: 0.35, damping: 0.85 })
const sepTarget = () => (ui.explode ? Math.max(0, Math.min(15, ui.separation)) : 0)
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
function startExplode() {
  readySent = false
  if (reduced()) sepSpring.snap(sepTarget())
  else sepSpring.set(sepTarget())
  dirty = true
}
/** Explode toggled: the camera frames the stack at its target separation, landing with the explode. */
function onExplode() {
  const s0 = sepSpring.value
  startExplode()
  if (!camera || !fitted) return
  const dir = camera.position.clone().sub(controls.target).normalize()
  const { centre, dist } = frame(dir)
  const near = Math.max(0.05, dist / 200),
    far = dist * 20
  const from = poseOf(controls.target, camera.position),
    to = poseOf(centre, centre.clone().addScaledVector(dir, dist))
  if (reduced() || !stackFit.start(from, to, s0, sepSpring.target)) return moveCamera(centre, dir, dist, near, far, reduced())
  camMoving = false
  camRestore = null
  camera.near = Math.min(near, camera.near)
  camera.far = Math.max(far, camera.far)
  camNearFar = [near, far]
  camera.updateProjectionMatrix()
}
function stepStackFit() {
  if (!stackFit.active) return
  const p = stackFit.at(sepSpring.value)!
  controls.target.copy(p.target)
  camera.position.copy(positionOf(p))
  dirty = true
  if (!stackFit.active && camNearFar) {
    camera.near = camNearFar[0]
    camera.far = camNearFar[1]
    camera.updateProjectionMatrix()
  }
}
function stepExplode(dt: number) {
  if (sepSpring.step(dt) || sepSpring.value !== sepNow) applyExplode(sepSpring.value)
}
function applyExplode(sep: number) {
  sepNow = sep
  if (!pcb.explode(sep)) return
  grid.setZ(gridBaseZ + Math.min(0, pcb.offset('bodies:B')))
  if (links.root) buildLinks()
  if (dotLayer.mesh.count) drawDots()
  drawTools()
  updateLabels()
  dirty = true
}
const calloutsOpen = () => sepSpring.target > 0 && sepNow > 0.3
function updateLabels() {
  const open = calloutsOpen()
  if (!open && hoverLayer.value) setLayerHover(null)
  stack?.update(open, open || sepNow > 0.05, hoverLayer.value, g => !!pcb.groups.get(g)?.visible)
  dirty = true
}
const endPt = new THREE.Vector3()
/** Per drawn frame: each candidate's label at its copper on screen, its layer's explode offset included; hidden behind the camera. */
function layoutEnds() {
  const box = endLayer.value
  if (!box || !renderer || !pcb.board) return
  const el = renderer.domElement,
    w = el.clientWidth,
    h = el.clientHeight
  endMarks.value.forEach((m, i) => {
    const node = box.children[i] as HTMLElement | undefined
    if (!node) return
    endPt.set(m.at[0], m.at[1], m.at[2] + (pcb.groups.get(`${m.side}.Cu`)?.position.z ?? 0))
    pcb.root.localToWorld(endPt).project(camera)
    const out = endPt.z > 1 || Math.abs(endPt.x) > 1.2 || Math.abs(endPt.y) > 1.2
    node.style.display = out ? 'none' : ''
    node.style.transform = `translate(${(((endPt.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - endPt.y) / 2) * h).toFixed(1)}px)`
  })
}
/** The candidate under a pick: the pad it hit, else the nearest within a millimetre. */
function endUnder(p: ScenePick | null): string | null {
  const e = ends.value
  if (!e || !p) return null
  const i = p.info
  const hit = i?.kind === 'pad' && i.ref && i.pad ? e.ends.candidates.find(c => c.ref === `${i.ref}/${i.pad}`) : undefined
  return (hit ?? (p.at ? nearestEnd(e, p.at, 1) : null))?.handle ?? null
}
function pickHandle(handle: string) {
  const c = viewer.edit.client
  if (!c) return
  pickEnd(c, props.board.name, viewer.run, handle, props.sel.isolate?.ref ?? null)
    .then(r => {
      if (r.error) viewer.note(r.error, true)
      else if (r.written[0]) viewer.edit.last = r.written[0].file
    })
    .catch(err => viewer.note(String((err as Error)?.message ?? err), true))
}
function setLayerHover(name: string | null) {
  if (name && !calloutsOpen()) name = null
  if (hoverLayer.value === name) return
  hoverLayer.value = name
  updateLabels()
  pcb.hoverLayer(name)
}

function outlineStyles(): Record<OutlineState, OutlineStyle> {
  const accent = cssColor('--accent', '#6ea8ff')
  return {
    ctx: { color: accent, width: 1.5, alpha: 0.4 },
    hover: { color: '#ffffff', width: 1.5, alpha: 0.5 },
    sel: { color: accent, width: 1.5, alpha: 1 },
    anchor: { color: accent, width: 2, alpha: 1 },
  }
}

// critically damped: a move settles in about 350 ms and a new preset retargets mid-flight
const CAM = { response: 0.28, damping: 1 }
const cam = {
  tx: new Spring(0, CAM),
  ty: new Spring(0, CAM),
  tz: new Spring(0, CAM),
  r: new Spring(1, CAM),
  polar: new Spring(0, CAM),
  azimuth: new Spring(0, CAM),
  fov: new Spring(35, CAM),
  zoom: new Spring(1, CAM),
}
let camMoving = false
let camRestore: CameraSnapshot | null = null
const stackFit = new StackFit()
function spherical(off: THREE.Vector3) {
  const r = off.length() || 1
  return { r, polar: Math.acos(Math.max(-1, Math.min(1, off.z / r))), azimuth: Math.atan2(off.y, off.x) }
}
function moveCamera(centre: THREE.Vector3, dir: THREE.Vector3, dist: number, near: number, far: number, instant = false) {
  stackFit.stop()
  camRestore = null
  const now = spherical(camera.position.clone().sub(controls.target)),
    to = spherical(dir.clone().multiplyScalar(dist))
  if (instant || reduced() || !fitted) {
    controls.target.copy(centre)
    camera.position.copy(centre).addScaledVector(dir, dist)
    camMoving = false
    camera.near = near
    camera.far = far
  } else {
    if (!camMoving) {
      cam.tx.snap(controls.target.x)
      cam.ty.snap(controls.target.y)
      cam.tz.snap(controls.target.z)
      cam.r.snap(now.r)
      cam.polar.snap(now.polar)
      cam.azimuth.snap(now.azimuth)
      cam.fov.snap(camera.fov)
      cam.zoom.snap(camera.zoom)
    }
    // the shorter way round
    let az = to.azimuth
    while (az - cam.azimuth.value > Math.PI) az -= 2 * Math.PI
    while (az - cam.azimuth.value < -Math.PI) az += 2 * Math.PI
    cam.tx.set(centre.x)
    cam.ty.set(centre.y)
    cam.tz.set(centre.z)
    cam.r.set(to.r)
    cam.polar.set(to.polar)
    cam.azimuth.set(az)
    camMoving = true
  }
  if (camMoving) {
    camera.near = Math.min(near, camera.near)
    camera.far = Math.max(far, camera.far)
    camNearFar = [near, far]
  }
  camera.updateProjectionMatrix()
  controls.update()
  dirty = true
}
let camNearFar: [number, number] | null = null
function stepCamera(dt: number) {
  if (!camMoving) return
  let busy = false
  for (const s of Object.values(cam)) busy = s.step(dt) || busy
  controls.target.set(cam.tx.value, cam.ty.value, cam.tz.value)
  const r = cam.r.value,
    p = cam.polar.value,
    a = cam.azimuth.value
  camera.position.set(controls.target.x + r * Math.sin(p) * Math.cos(a), controls.target.y + r * Math.sin(p) * Math.sin(a), controls.target.z + r * Math.cos(p))
  camera.fov = cam.fov.value
  camera.zoom = cam.zoom.value
  camera.updateProjectionMatrix()
  dirty = true
  if (!busy) {
    if (camRestore) return restorePose(camRestore)
    camMoving = false
    if (camNearFar) {
      camera.near = camNearFar[0]
      camera.far = camNearFar[1]
      camera.updateProjectionMatrix()
    }
  }
}

/** Frame the current layout along `dir`, reserving the callout column when exploded. */
function frame(dir: THREE.Vector3) {
  const box = pcb.bounds(sepTarget())
  const area = props.frameArea ?? props.iso?.box
  if (area) {
    box.min.x = area[0]
    box.max.x = area[0] + area[2]
    box.min.y = -(area[1] + area[3])
    box.max.y = -area[1]
  }
  const vfov = (camera.fov * Math.PI) / 180
  fitRadius = fitSphere(box)!.radius
  const w = renderer?.domElement.clientWidth ?? 0
  const share = sepTarget() === 0 ? 0 : (stack?.share(w, g => !!pcb.groups.get(g)?.visible) ?? 0)
  const centre = box.getCenter(new THREE.Vector3())
  if (!share) return { centre, dist: fitDistance(box, dir, camera.up, vfov, camera.aspect) }
  const { dist, shift } = fitBeside(box, dir, camera.up, vfov, camera.aspect, share)
  return { centre: centre.add(shift), dist }
}

function view(kind: 'fit' | 'top' | 'bottom' | 'iso') {
  if (!camera) return
  let dir: THREE.Vector3
  if (kind === 'fit') dir = camera.position.clone().sub(controls.target).normalize()
  // the tiny y offsets pick screen-up at the poles: north up from above, back text left to right from below
  else if (kind === 'top') dir = new THREE.Vector3(0, -1e-3, 1)
  else if (kind === 'bottom') dir = new THREE.Vector3(0, 1e-3, -1)
  else dir = new THREE.Vector3(...ISO_DIR)
  if (!isFinite(dir.x) || dir.lengthSq() === 0) dir = new THREE.Vector3(...ISO_DIR)
  dir.normalize()
  const { centre, dist } = frame(dir)
  moveCamera(centre, dir, dist, Math.max(0.05, dist / 200), dist * 20)
}

const firstView = (): 'bottom' | 'iso' => (props.fromBelow ? 'bottom' : 'iso')

/** The scene matrix of an isolation's definition frame: board (x, -y, z) to the frame's, a mirrored frame turned over so its front faces up. */
function frameMatrix(): THREE.Matrix4 {
  const f = props.iso?.frame
  const m = new THREE.Matrix4()
  if (!f) return m
  const [a, b, c, d, e, g] = invertMat(f)
  const flip = a * d - b * c < 0
  return m.set(a, -c, 0, e, -b, d, 0, -g, 0, 0, flip ? -1 : 1, flip ? props.board.thickness : 0, 0, 0, 0, 1)
}
/** Put the board, the tools and the drag preview in the shown frame, and the grid under them. */
function placeFrame() {
  if (!pcb.board) return
  const m = frameMatrix()
  pcb.setFrame(m)
  if (tools) {
    tools.root.matrixAutoUpdate = false
    tools.root.matrix.copy(m)
    tools.root.matrixWorldNeedsUpdate = true
  }
  // the grid under the unexploded board, bodies included
  pcb.explode(0)
  pcb.root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(pcb.root)
  if (!box.isEmpty()) {
    grid.build(box)
    gridBaseZ = grid.z
  }
  applyExplode(sepNow)
  // a drag held over a rebuild or a new frame: its pads made again from the placed meshes, in this frame
  if (tt.pose.value) drawPose()
  dirty = true
}

/** Frame frameRef; the move is instant until the first fit is done. */
function frameNow() {
  const fp = props.frameRef ? props.board.footprints.find(f => f.ref === props.frameRef) : undefined
  const a = props.frameArea
  if (!fp && a && camera) {
    const d = new THREE.Vector3(...(props.fromBelow ? FOCUS_BELOW : FOCUS_DIR)).normalize()
    const { centre, dist } = frame(d)
    moveCamera(centre, d, dist, Math.max(0.01, dist / 200), dist * 20)
    return true
  }
  if (!fp) return false
  return focus(fp.ref, props.fromBelow ? FOCUS_BELOW : undefined, Math.max(fp.body.w, fp.body.h, fp.height, 2) * 5 + 10)
}

/** Frame one part: the camera at `dist` mm from its body centre along `dir` (three axes, z up). */
function focus(ref: string, dir: [number, number, number] = FOCUS_DIR, dist = 6) {
  const fp = props.board.footprints.find(f => f.ref === ref)
  if (!fp || !camera) return false
  const z = fp.side === 'B' ? -fp.height / 2 : props.board.thickness + fp.height / 2
  const centre = new THREE.Vector3(fp.body.x, -fp.body.y, z).applyMatrix4(frameMatrix())
  const d = new THREE.Vector3(...dir).normalize()
  if (Math.abs(d.z) > 0.999) d.y += d.z > 0 ? -1e-3 : 1e-3
  moveCamera(centre, d.normalize(), dist, Math.max(0.01, dist / 200), dist * 200)
  return true
}

let firstFrameAt = 0
const deltas: number[] = [],
  renders: number[] = []
// the draw calls of the last frame's scene pass, the outline's passes left out
let calls = 0
let lastFrame = 0
function stats() {
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  const p95 = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : 0)
  const s = pcb.stats
  return {
    frames: deltas.length,
    avgFrameMs: +avg(deltas).toFixed(2),
    p95FrameMs: +p95(deltas).toFixed(2),
    avgRenderMs: +avg(renders).toFixed(2),
    buildMs: +s.buildMs.toFixed(1),
    geometryMs: +s.geometryMs.toFixed(0),
    landings: [...s.landings],
    workers: [...pool.log],
    firstFrameAt: +firstFrameAt.toFixed(0),
    completeAt: +s.completeAt.toFixed(0),
    meshes: pcb.meshes,
    geometries: geoCache.size,
    calls,
    triangles: renderer?.info.render.triangles ?? 0,
  }
}
/** Orbit the camera once around its target over `frames` frames, rendering each, and report the timings. */
function bench(frames = 240): Promise<ReturnType<typeof stats>> {
  deltas.length = 0
  renders.length = 0
  const off = camera.position.clone().sub(controls.target)
  let i = 0
  return new Promise(resolve => {
    const step = () => {
      if (i++ >= frames) {
        resolve(stats())
        return
      }
      off.applyAxisAngle(new THREE.Vector3(0, 0, 1), (Math.PI * 2) / frames)
      camera.position.copy(controls.target).add(off)
      camera.lookAt(controls.target)
      dirty = true
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}
defineExpose({ view, focus, stats, bench })

let fitRadius = 50
/** Screen pixels per mm at the camera's target. */
function pxPerMm() {
  const d = camera.position.distanceTo(controls.target) || 1
  return (renderer?.domElement.clientHeight ?? 800) / (2 * d * Math.tan((camera.fov * Math.PI) / 360))
}

// the fog starts past the far side of the board, so it only fades the grid into the canvas
function stepFog() {
  const fog = scene.fog as THREE.Fog | null
  if (!fog) return
  const d = camera.position.distanceTo(controls.target)
  fog.near = d + fitRadius * 1.5
  fog.far = d + fitRadius * 6
}

function applyTheme() {
  if (!scene || !host.value) return
  const css = getComputedStyle(host.value)
  const token = (k: string) => css.getPropertyValue(k).trim()
  let bg: THREE.Color
  try {
    bg = new THREE.Color(token('--canvas') || '#0e1013')
  } catch {
    bg = new THREE.Color('#0e1013')
  }
  scene.background = bg
  scene.fog = new THREE.Fog(bg, 1e5, 2e5)
  grid.setTones({ minor: token('--grid-minor'), major: token('--grid-major'), origin: token('--grid-origin') })
  outline?.style(outlineStyles(), renderer?.getPixelRatio() ?? 1)
  pcb.theme()
  drawDots()
  dirty = true
}

function resize() {
  const el = host.value
  if (!el || !renderer) return
  const w = Math.max(1, el.clientWidth),
    h = Math.max(1, el.clientHeight)
  renderer.setSize(w, h, false)
  const v = renderer.getDrawingBufferSize(new THREE.Vector2())
  links.resize(v)
  dotLayer.resolution(v.x, v.y)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  if (fitted && props.frameArea) syncCameraFocus(true)
  dirty = true
}

function loop(now: number) {
  raf = requestAnimationFrame(loop)
  // at most two frames per step, so the springs never jump after a long gap or a hidden tab
  const dt = lastFrame ? Math.min(now - lastFrame, 34) / 1000 : 0
  if (env.dev && lastFrame) {
    deltas.push(now - lastFrame)
    if (deltas.length > 600) deltas.shift()
  }
  lastFrame = now
  stepExplode(dt)
  stepStackFit()
  stepCamera(dt)
  stepFog()
  if (pcb.step(now)) dirty = true
  const moved = controls.update()
  const mmPx = 1 / pxPerMm()
  if (Math.abs(mmPx / pxMm.value - 1) > 0.03) pxMm.value = mmPx
  if (grid.update(camera, pxPerMm())) dirty = true
  if (stack?.stepWires(gridStep(pxPerMm()).minor)) dirty = true
  if (links.step(linkScale())) dirty = true
  // only a line in focus marches, once the board has meshed; at rest nothing redraws
  if (pcb.meshed && links.march(now)) dirty = true
  // the hover follows the pointer once a frame, before the frame draws it
  if (pendingHover) {
    const e = pendingHover
    pendingHover = null
    hoverAt(e)
  }
  syncOutline()
  const changed = dirty
  if ((moved || dirty || hoverDirty) && renderer) {
    dotXY = null
    const t = performance.now()
    // one walk of the scene a frame: the outline's depth pass reuses it
    scene.updateMatrixWorld()
    renderer.render(scene, camera)
    calls = renderer.info.render.calls
    outline?.render(renderer, scene, camera, !focusOn.value, seeThrough(), !moved && !dirty)
    if (stack) stack.layout(camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight, g => pcb.groups.get(g)?.position.z ?? 0)
    layoutEnds()
    layoutNotes()
    if (pcb.meshed && !paintSent) {
      paintSent = true
      const my = pcb.gen
      requestAnimationFrame(() => {
        if (my === pcb.gen && alive) setPainted('3d')
      })
    }
    if (env.dev) {
      // what the frame drew under the pointer, for the view bench
      host.value?.setAttribute('data-hover', hoverRef.value ?? '')
      renders.push(performance.now() - t)
      if (renders.length > 600) renders.shift()
      if (!firstFrameAt && pcb.board) firstFrameAt = performance.now()
    }
    dirty = hoverDirty = false
  }
  // ready: drawn and still; the mark goes on the frame after it
  if (!readySent && pcb.complete && !moved && !changed && !camMoving && !stackFit.active && sepSpring.settled) {
    readySent = true
    const my = pcb.gen
    requestAnimationFrame(() => {
      if (my === pcb.gen && readySent && alive) setReady('3d', host.value)
    })
  }
}

/** The board point under the pointer on a copper layer's plane. */
function planeAt(e: { clientX: number; clientY: number }, layer: string): [number, number] | null {
  if (!renderer || !camera) return null
  setRay(e)
  const ray = raycaster.ray.clone().applyMatrix4(pcb.root.matrixWorld.clone().invert())
  return onPlane(ray.origin, ray.direction, pcb.faceZ(layer))
}
function toolColors(): ToolColors {
  return {
    accent: cssColor('--accent', '#6ea8ff'),
    rim: '#ffffff',
    panel: cssColor('--canvas', '#0e1013'),
    dim: cssColor('--canvas-dim', '#8a8f98'),
    copper: pcb.copper,
  }
}
/** The ring, the control points, the grid in effect and the assist's dots, marks and trace, each on its plane. */
// what each tool part was last drawn from: a part whose inputs are the same objects is left as it is, so a drag redraws the ring alone
const toolInputs = new Map<string, unknown[]>()
const toolChanged = (part: string, ...v: unknown[]) => {
  const was = toolInputs.get(part)
  if (was && was.length === v.length && was.every((x, i) => x === v[i])) return false
  toolInputs.set(part, v)
  return true
}
function drawTools() {
  if (!tools || !pcb.board) return
  const c = toolColors(),
    px = pxMm.value,
    as = tt.as
  const zOf = (l: string) => pcb.faceZ(l)
  const z = zOf(tt.plane.value),
    zd = zOf(tt.dotPlane.value),
    look = Object.values(c).join()
  const start = as.on.value ? (as.ctx.value?.start ?? null) : null
  if (toolChanged('ring', tt.tl.ring.value, z, px, look)) tools.ring(tt.tl.ring.value, z, px, c)
  if (toolChanged('points', tt.tl.points.value, tt.tl.focus.value, z, px, look)) tools.points(tt.tl.points.value, tt.tl.focus.value, z, px, c)
  if (toolChanged('grid', tt.grid.value, z, look)) tools.grid(tt.grid.value, z, c.dim)
  if (toolChanged('gridDots', tt.gridDots.value, z, look)) tools.gridDots(tt.gridDots.value, z, renderer?.getPixelRatio() ?? 1, c)
  if (toolChanged('dots', tt.dots.value, zd, look)) tools.dots(tt.dots.value, zd, renderer?.getPixelRatio() ?? 1, c)
  if (toolChanged('marks', start, as.hover.value, zd, px, look)) tools.marks(start, as.hover.value, zd, px, c)
  if (toolChanged('trace', as.preview.value, sepNow, as.ctx.value?.width, px, look)) tools.trace(as.preview.value, zOf, as.ctx.value?.width ?? 0.2, px, c)
  dirty = true
}
/** The gesture's pose drawn where it goes. */
function drawPose() {
  pcb.pose(tt.pose.value)
  dirty = true
}
/** What a press lands on: a tool handle, else the item or part the selection geometry names. */
function toolHit(e: PointerEvent): ToolHit {
  const p = pick(e)
  return tools?.handleAt(raycaster) ?? toolHitOf(p?.info)
}
/** Before the orbit sees a press: the tools take it or let it through. */
function onToolDown(e: PointerEvent) {
  if (!renderer || e.target !== renderer.domElement || !pcb.board) return
  // a route end slot picks on the click through pick(), as the end labels do, never the assist's plane
  if (ends.value) return
  if (!tt.down(e, toolHit(e))) return
  toolPress = true
  controls.enabled = false
  renderer.domElement.setPointerCapture(e.pointerId)
}
function zoomBy(f: number) {
  camera.position.sub(controls.target).multiplyScalar(f).add(controls.target)
  dirty = true
}

usePinch(
  host,
  () => {
    tt.cancel()
    toolPress = false
    downAt = null
    controls.enabled = true
    camMoving = false
    camRestore = null
    camNearFar = null
    stackFit.stop()
    controls.enableDamping = false
    controls.update()
    controls.enableDamping = true
    onLeave()
  },
  ({ from, to, scale }) => {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), controls.target)
    setRay({ clientX: from[0], clientY: from[1] })
    const before = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
    const distance = camera.position.distanceTo(controls.target)
    const next = Math.max(Math.max(camera.near * 2, controls.minDistance), Math.min(controls.maxDistance, distance * scale))
    zoomBy(next / distance)
    camera.updateMatrixWorld()
    setRay({ clientX: to[0], clientY: to[1] })
    const after = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
    if (before && after) {
      const delta = before.sub(after)
      controls.target.add(delta)
      camera.position.add(delta)
    }
    controls.update()
  },
)

/** The pick grids built in idle time once a build has meshed, a few meshes per idle slice. */
function warmPicks(my: number) {
  const idle = (fn: (d: { timeRemaining(): number }) => void) =>
    typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : setTimeout(() => fn({ timeRemaining: () => 8 }), 50)
  const slice = (d: { timeRemaining(): number }) => {
    if (my === pcb.gen && alive && pcb.warm(() => d.timeRemaining())) idle(slice)
  }
  idle(slice)
}
function setRay(e: { clientX: number; clientY: number }) {
  const r = renderer!.domElement.getBoundingClientRect()
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
}
function pick(e: { clientX: number; clientY: number }): ScenePick | null {
  setRay(e)
  return pcb.pick(raycaster.ray, props.stale ?? NONE)
}
const asPicked = (i: ItemInfo): Picked =>
  i.kind === 'body' ? { ref: i.ref, id: null, kind: 'body' } : { ...(i.ref ? { ref: i.ref } : {}), id: i.id, kind: i.kind, ...(i.net ? { net: i.net } : {}) }
/** A picked item as the selection reads it, at a board point. */
const hitOf = (i: ItemInfo | null, at: [number, number] | null): Hit | null =>
  i ? { kind: i.kind, id: i.kind === 'body' ? null : i.id, ref: i.ref ?? null, net: i.net ?? null, pad: i.pad ?? null, at } : null
const localHover = ref<ItemInfo | null>(null)
// a net only when the target is one
const hoverRef = useHover({ hit: () => hitOf(localHover.value, null), site: () => props.board, sel: () => props.sel, deep: () => page.deep, hover: viewer.hover }, h =>
  emit('net', h?.net ?? null),
)
function setHover(info: ItemInfo | null) {
  const prev = localHover.value
  if (prev === info || (prev && info && prev.id === info.id && prev.layer === info.layer && prev.ref === info.ref)) return
  localHover.value = info
  emit('hover', info ? { ...asPicked(info), layer: info.layer } : null)
}
usePointer(
  host,
  e => {
    tt.cancel()
    toolPress = false
    downAt = null
    if (controls) controls.enabled = true
    if (e && renderer) renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, pointerType: e.pointerType }))
    if (controls) {
      const damping = controls.enableDamping
      controls.enableDamping = false
      controls.update()
      controls.enableDamping = damping
    }
  },
  onLeave,
)

function onMove(e: PointerEvent) {
  if (toolPress) {
    tt.move(e)
    return
  }
  tt.move(e)
  if (tt.as.on.value) chipAt.value = [e.offsetX, e.offsetY]
  if (e.buttons) {
    pendingHover = null
    hover.value = null
    setHover(null)
    setLayerHover(null)
    setDotHover(null, null)
    return
  }
  if (!pointerInside(host.value, e)) return onLeave()
  pendingHover = e
}
// the last pointer move not yet tested, at most one ray and one dot test a frame
let pendingHover: PointerEvent | null = null
/** What lies under the pointer: a finding's dot first, else the item a click would select, the line, the layer and the tool handle. */
function hoverAt(e: PointerEvent) {
  if (!renderer || !pcb.board || toolPress) return
  const r = host.value!.getBoundingClientRect()
  const x = e.clientX - r.left,
    y = e.clientY - r.top
  const dot = dotAt(e)
  setDotHover(dot, dot === null ? null : [x, y])
  if (dot !== null) {
    hover.value = null
    hoverLine.value = null
    setHover(null)
    renderer.domElement.style.cursor = 'pointer'
    return
  }
  const p = pick(e)
  const info = p?.info ?? null
  hoverLine.value = lineUnder()
  if (ends.value) endPointer.value = endUnder(p)
  setLayerHover(p?.group && stack?.has(p.group) ? p.group : null)
  setHover(info)
  if (tools?.handleAt(raycaster)) {
    renderer.domElement.style.cursor = 'grab'
    return
  }
  if (!info) {
    hover.value = null
    renderer.domElement.style.cursor = ''
    return
  }
  if (info.kind === 'body') {
    const fp = props.board.footprints.find(f => f.ref === info.ref)!
    hover.value = {
      title: fp.displayRef ?? fp.ref,
      value: fp.value,
      detail: [describe(fp.model, { value: fp.value, fields: fp.fields ?? {} }), fp.side === 'B' ? 'back' : 'front'].filter(Boolean).join(', '),
      x,
      y,
      item: info,
      ref: fp.ref,
    }
  } else {
    const title = info.ref ? `${displayRef(props.board, info.ref)}${info.pad ? '/' + info.pad : ''}` : (info.net ?? info.kind)
    const route = info.kind === 'track' ? routeHover(props.board, info) : null
    const detail = route ? `${route.startsWith(`${info.net}, `) ? route.slice(info.net!.length + 2) : route}, ${info.layer}` : `${info.kind} on ${info.layer}`
    hover.value = { title, value: info.ref ? (info.net ?? '') : '', detail, x, y, item: info, ref: info.ref }
  }
  renderer.domElement.style.cursor = 'pointer'
}
function onDown(e: PointerEvent) {
  downAt = [e.clientX, e.clientY]
}
function onUp(e: PointerEvent) {
  if (toolPress) {
    toolPress = false
    controls.enabled = true
    downAt = null
    if (tt.up() !== 'click') return
    if (!pointerInside(host.value, e)) return
    const dot = e.button === 0 ? dotAt(e) : null
    if (dot !== null) return clickDot(dot, e)
    const p = pick(e)
    emit('pick', hitOf(p?.info ?? null, p?.at ?? null), modsOf(e))
    return
  }
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) {
    downAt = null
    return
  }
  downAt = null
  if (!pointerInside(host.value, e)) return
  if (e.pointerType === 'touch' && tt.as.on.value) {
    tt.move(e)
    if (tt.as.down(e)) return
  }
  const dot = e.button === 0 ? dotAt(e) : null
  if (dot !== null) return clickDot(dot, e)
  const p = pick(e)
  const handle = e.button === 0 ? endUnder(p) : null
  if (handle) return pickHandle(handle)
  const line = e.button === 0 ? lineUnder() : null
  const id = line !== null ? findLines.value[line]?.findings[0]?.id : undefined
  if (id) return emit('finding', id, modsOf(e))
  emit('pick', hitOf(p?.info ?? null, p?.at ?? null), modsOf(e))
}
function onDouble(e: MouseEvent) {
  const p = pick(e)
  emit('enter', hitOf(p?.info ?? null, p?.at ?? null))
}
function onLeave() {
  if (renderer) renderer.domElement.style.cursor = ''
  endPointer.value = null
  pendingHover = null
  setDotHover(null, null)
  tt.as.leave()
  hoverLine.value = null
  hover.value = null
  setHover(null)
  setLayerHover(null)
}

watch(
  () => page.grid,
  on => {
    grid.on = on
    dirty = true
  },
)
function toggleFade() {
  ui.fade = !ui.fade
  if (props.fade === undefined) store.set('pcbjs.3d.fade', ui.fade ? '1' : '0')
  emit('update:fade', ui.fade)
}
function setLook(k: keyof typeof look, v: number | boolean) {
  ;(look as Record<string, number | boolean>)[k] = v
  store.set(`pcbjs.3d.look.${k}`, String(v))
}
const onOpacity = (e: Event) => setLook('opacity', Math.max(0.05, Math.min(1, +(e.target as HTMLInputElement).value)))
function toggleExplode() {
  ui.explode = !ui.explode
  emit('update:explode', ui.explode)
}
function onSeparation(e: Event) {
  stackFit.stop()
  ui.separation = Math.max(0, Math.min(15, +(e.target as HTMLInputElement).value))
  if (props.separation === undefined) store.set('pcbjs.3d.separation', String(ui.separation))
  emit('update:separation', ui.separation)
}

onMounted(() => {
  const el = host.value!
  if (props.fade === undefined && store.get('pcbjs.3d.fade') === '0') ui.fade = false
  const op = Number(store.get('pcbjs.3d.look.opacity'))
  if (store.get('pcbjs.3d.look.opacity') !== null && isFinite(op)) look.opacity = Math.max(0.05, Math.min(1, op))
  for (const k of ['mono', 'edges', 'grouped'] as const) {
    const v = store.get(`pcbjs.3d.look.${k}`)
    if (v !== null) look[k] = v === 'true'
  }
  const sep = Number(store.get('pcbjs.3d.separation'))
  if (props.separation === undefined && store.get('pcbjs.3d.separation') !== null && isFinite(sep)) ui.separation = Math.max(0, Math.min(15, sep))
  grid.on = page.grid
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.domElement.className = 'view3d-canvas'
  el.prepend(renderer.domElement)
  callLayer = document.createElement('div')
  callLayer.className = 'view3d-labels'
  const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  leaders.classList.add('view3d-leaders')
  callLayer.append(leaders)
  renderer.domElement.after(callLayer)
  stack = new StackLabels(callLayer, leaders, setLayerHover)
  scene = new THREE.Scene()
  scene.matrixWorldAutoUpdate = false
  scene.add(grid.root)
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000)
  camera.up.set(0, 0, 1)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.addEventListener('change', () => {
    dirty = true
  })
  // the user takes the camera: a preset move in flight stops where it is
  controls.addEventListener('start', () => {
    camMoving = false
    camRestore = null
    camNearFar = null
    stackFit.stop()
  })
  // a soft room for the metal parts to reflect; the lights below do the shaping
  const pmrem = new THREE.PMREMGenerator(renderer)
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = envMap
  scene.environmentIntensity = 0.35
  scene.add(new THREE.HemisphereLight('#ffffff', '#3a3a3a', 1.4))
  // the sun from the front left, so its glint in the glossy mask stays out of the preset views, see ./scene/lights
  const sun = new THREE.DirectionalLight('#ffffff', 1.8)
  sun.position.set(...SUN)
  scene.add(sun)
  const under = new THREE.DirectionalLight('#ffffff', 0.6)
  under.position.set(...UNDER)
  scene.add(under)
  outline = new Outline()
  tools = new ToolLayer()
  scene.add(pcb.root, tools.root, pcb.ghosts)
  pcb.setLook(look)
  el.addEventListener('pointerdown', onToolDown, { capture: true })
  applyTheme()
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(el)
  mo = new MutationObserver(applyTheme)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
  mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', applyTheme)
  const c = renderer.domElement
  c.addEventListener('pointermove', onMove)
  c.addEventListener('pointerdown', onDown)
  c.addEventListener('pointerup', onUp)
  c.addEventListener('dblclick', onDouble)
  c.addEventListener('pointerleave', onLeave)
  if (env.dev)
    (window as any).__pcbjs3d = {
      scene,
      camera,
      pcb,
      get groups() {
        return pcb.groups
      },
      render: () => (dirty = true),
      get calls() {
        return calls
      },
    }
  // Build and fit once in the requested stack state before capturing any focus checkpoint.
  sepSpring.snap(sepTarget())
  sepNow = sepSpring.value
  setBoard(undefined)
  markPoints()
  buildLinks()
  // A line finding needs its freshly built midpoint before it can take the camera.
  syncCameraFocus()
  drawDots()
  drawTools()
  raf = requestAnimationFrame(loop)
})

watch(
  () => props.board,
  (now, was) => {
    if (keyOfSite(now) !== keyOfSite(was)) {
      if (camera && fitted) focusTransaction<SavedCamera>(ctx.pane.focusViews, keyOfSite(was), '3d').save(cameraPose())
      camMoving = false
      camRestore = null
      stackFit.stop()
      camNearFar = null
      fitted = false
      lastFrameKey = lastFindingKey = ''
      cameraHadFocus = false
    }
    setBoard(was)
    drawTools()
  },
)
watch(
  () => props.iso?.frame?.join(),
  () => placeFrame(),
)
watch(
  () => [props.frameRef, props.frameArea, props.finding, props.iso, props.fromBelow, props.board],
  () => syncCameraFocus(),
  { flush: 'post' },
)
watch(endMarks, () => {
  endPointer.value = null
  dirty = true
})
watch(paint, applyPaint)
// a hover changes the outline alone, in the frame that tested it
watch(hoverRef, applyPaint, { flush: 'sync' })
watch(
  () => (ends.value ? endIds(props.board, ends.value) : []),
  ids => {
    pcb.setEnds(ids)
    hoverDirty = true
  },
)
watch(() => [dotNotes.value, props.finding, props.stale], drawDots, { flush: 'post' })
watch(() => [props.drawn?.points, props.board], markPoints, { flush: 'post' })
watch(
  () => [
    tt.tl.ring.value,
    tt.tl.points.value,
    tt.tl.focus.value,
    tt.grid.value,
    tt.gridDots.value,
    tt.dots.value,
    tt.as.hover.value,
    tt.as.preview.value,
    tt.as.on.value,
    pxMm.value,
  ],
  drawTools,
  { flush: 'post' },
)
watch(tt.pose, drawPose)
// the key map's commands while this view shows, as the 2D view answers them
const shownNow = () => !!host.value?.offsetParent
const viewCommand = (fn: () => void) => () => shownNow() && (fn(), true)
useCommands(ctx.commands, {
  fit: viewCommand(() => view('fit')),
  zoomIn: viewCommand(() => zoomBy(1 / 1.25)),
  zoomOut: viewCommand(() => zoomBy(1.25)),
  ...Object.fromEntries(['up', 'move', 'rotate', 'side', 'points', 'delete'].map(id => [id, () => shownNow() && tt.command(id)])),
})
watch(() => [props.drawn, props.board, page.ratsnest, ends.value, props.iso, props.stale, props.review], buildLinks, { flush: 'post' })
watch(() => [...labelLines.value].join(), restyleLinks, { flush: 'post' })
watch(
  () => [visibleNotes.value, noteHover.value, props.finding],
  () => {
    dirty = true
  },
  { flush: 'post' },
)
watch(
  () => props.fade,
  v => {
    if (v !== undefined && v !== ui.fade) ui.fade = v
  },
)
watch(
  () => props.explode,
  v => {
    if (v !== undefined && v !== ui.explode) ui.explode = v
  },
)
watch(
  () => props.separation,
  v => {
    if (v !== undefined && v !== ui.separation) ui.separation = v
  },
)
watch(() => ui.explode, onExplode)
watch(look, () => {
  pcb.setLook(look)
  dirty = true
})
watch(
  () => ui.separation,
  () => {
    if (ui.explode) startExplode()
  },
)

onBeforeUnmount(() => {
  if (camera && fitted) cameraTransaction().save(cameraPose())
  cancelAnimationFrame(raf)
  alive = false
  ro?.disconnect()
  mo?.disconnect()
  mq?.removeEventListener('change', applyTheme)
  controls?.dispose()
  pcb.dispose()
  links.dispose()
  stack?.dispose()
  pool.dispose()
  geoCache.dispose()
  grid.clear()
  dotLayer.dispose()
  outline?.dispose()
  outline = null
  envMap?.dispose()
  envMap = null
  callLayer?.remove()
  callLayer = null
  host.value?.removeEventListener('pointerdown', onToolDown, { capture: true })
  tt.cancel()
  tools?.clear()
  tools = null
  if (renderer) {
    renderer.dispose()
    renderer.domElement.remove()
    renderer = null
  }
})
</script>

<template>
  <div ref="host" class="view3d" data-ui="Canvas3D" data-ui-source="packages/ui/src/Canvas3D.vue">
    <div class="view3d-buttons" data-ui="Canvas3D.ViewControls">
      <button class="icon" title="Fit current layout" aria-label="Fit" @click="view('fit')">
        <svg viewBox="0 0 16 16"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
      </button>
      <button class="icon" title="Top view" aria-label="Top view" @click="view('top')">
        <svg viewBox="0 0 16 16">
          <rect x="3" y="7" width="10" height="6" rx="1" />
          <path d="M8 1.5v4M6 3.8L8 5.8l2-2" />
        </svg>
      </button>
      <button class="icon" title="Bottom view" aria-label="Bottom view" @click="view('bottom')">
        <svg viewBox="0 0 16 16">
          <rect x="3" y="3" width="10" height="6" rx="1" />
          <path d="M8 14.5v-4M6 12.2L8 10.2l2 2" />
        </svg>
      </button>
      <button class="icon" title="Iso view" aria-label="Iso view" @click="view('iso')">
        <svg viewBox="0 0 16 16"><path d="M8 2l5.5 3v6L8 14l-5.5-3V5zM8 8l5.5-3M8 8v6M8 8L2.5 5" /></svg>
      </button>
      <span class="view3d-sep"></span>
      <button class="icon" :class="{ on: page.grid }" :aria-pressed="page.grid" title="Millimetre grid (G)" aria-label="Grid" @click="toggleGrid">
        <svg viewBox="0 0 16 16"><path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" /></svg>
      </button>
      <button class="icon" :class="{ on: page.ratsnest }" :aria-pressed="page.ratsnest" title="Ratsnest and connections (N)" aria-label="Ratsnest" @click="toggleRatsnest">
        <svg viewBox="0 0 16 16">
          <path d="M3 12C5 4 11 4 13 12" stroke-dasharray="2 1.5" />
          <circle cx="3" cy="12" r="1.5" />
          <circle cx="13" cy="12" r="1.5" />
        </svg>
      </button>
      <span class="view3d-anchor">
        <button
          class="icon"
          :class="{ on: ui.fade }"
          :aria-pressed="ui.fade"
          title="Focus fade: dim everything but the selection, the net and the source highlight"
          aria-label="Focus fade"
          @click="toggleFade"
        >
          <svg viewBox="0 0 16 16">
            <circle cx="6" cy="8" r="4" />
            <circle cx="10.5" cy="8" r="4" stroke-dasharray="1.5 1.5" />
          </svg>
        </button>
      </span>
      <span class="view3d-anchor">
        <button class="icon" :class="{ on: ui.explode }" :aria-pressed="ui.explode" title="Explode the layers" aria-label="Explode" @click="toggleExplode">
          <svg viewBox="0 0 16 16"><path d="M2.5 3.5l5.5-2 5.5 2-5.5 2zM2.5 8.5l5.5-2 5.5 2-5.5 2zM2.5 13l5.5-2 5.5 2" /></svg>
        </button>
      </span>
    </div>
    <div v-if="focusOn || ui.explode" class="view3d-options" data-ui="Canvas3D.Appearance">
      <section v-if="focusOn" class="view3d-look" aria-label="Focus appearance">
        <h3>Focus</h3>
        <div class="view3d-row">
          <span class="view3d-label">Opacity</span>
          <input
            class="view3d-range"
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            :value="look.opacity"
            :title="`Out of focus at ${Math.round(look.opacity * 100)}% opacity`"
            aria-label="Opacity out of focus"
            @input="onOpacity"
          />
          <span class="view3d-val">{{ Math.round(look.opacity * 100) }}%</span>
          <button
            class="icon"
            :class="{ on: look.mono }"
            :aria-pressed="look.mono"
            title="Monochrome: grey out everything out of focus"
            aria-label="Monochrome"
            @click="setLook('mono', !look.mono)"
          >
            <svg viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="5.5" />
              <path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor" />
            </svg>
          </button>
        </div>
        <div class="view3d-row">
          <span class="view3d-seg" @keydown="onOptionKey" role="radiogroup" aria-label="Out of focus drawn as">
            <button :class="{ on: !look.edges }" role="radio" :aria-checked="!look.edges" :tabindex="!look.edges ? 0 : -1" title="Shaded faces" @click="setLook('edges', false)">
              Shaded
            </button>
            <button
              :class="{ on: look.edges }"
              role="radio"
              :aria-checked="look.edges"
              :tabindex="look.edges ? 0 : -1"
              title="Edges only, no faces"
              @click="setLook('edges', true)"
            >
              Edges
            </button>
          </span>
          <span class="view3d-seg" @keydown="onOptionKey" role="radiogroup" aria-label="Transparency">
            <button
              :class="{ on: look.grouped }"
              role="radio"
              :aria-checked="look.grouped"
              :tabindex="look.grouped ? 0 : -1"
              title="Grouped: one body, its hidden faces stay hidden"
              @click="setLook('grouped', true)"
            >
              Grouped
            </button>
            <button
              :class="{ on: !look.grouped }"
              role="radio"
              :aria-checked="!look.grouped"
              :tabindex="!look.grouped ? 0 : -1"
              title="Stacked: every surface shows through"
              @click="setLook('grouped', false)"
            >
              Stacked
            </button>
          </span>
        </div>
      </section>
      <section v-if="ui.explode" class="view3d-explosion" aria-label="Layer separation">
        <h3>Layer gap</h3>
        <div class="view3d-row">
          <input
            class="view3d-range"
            type="range"
            min="0"
            max="15"
            step="0.5"
            :value="ui.separation"
            :title="`${ui.separation} mm between layers`"
            aria-label="Layer separation in mm"
            @input="onSeparation"
          /><span class="view3d-val">{{ ui.separation }} mm</span>
        </div>
      </section>
    </div>
    <div v-if="endMarks.length" ref="endLayer" class="view3d-ends">
      <button
        v-for="m in endMarks"
        :key="m.handle"
        :class="['view3d-end', { on: endHover === m.handle }]"
        :data-handle="m.handle"
        :title="m.handle"
        @click="pickHandle(m.handle)"
        @pointerenter="endPointer = m.handle"
        @pointerleave="endPointer = null"
      >
        <span class="ring"></span><span class="lbl">{{ endHover === m.handle ? `${m.handle} · ${m.label}` : m.label }}</span>
      </button>
    </div>
    <div class="view3d-edit"><EditBar :tl="tt.tl" :as="tt.as" :chip="chipStyle" /></div>
    <div v-if="visibleNotes.length" ref="noteLayer" class="view3d-notes">
      <svg class="view3d-note-leads"><path v-for="n in visibleNotes" :key="n.key" :class="n.severity" /></svg>
      <button
        v-for="n in visibleNotes"
        :key="n.key"
        class="view3d-note"
        :class="[n.severity, n.check, { line: n.line !== null, stale: isStale(n.id), focus: !!n.id && n.id === finding, on: noteHover === n.key }]"
        :data-finding="n.id"
        :title="dotTitle(n)"
        @click="emit('finding', n.id, modsOf($event))"
        @pointerenter="onNote(n)"
        @pointerleave="noteHover = null"
      >
        <span class="ring"></span
        ><span class="lbl"
          ><svg v-if="n.broken" class="broken" viewBox="0 0 12 12" aria-label="unconnected"><path :d="BROKEN_ICON" /></svg>{{ noteHover === n.key ? dotTitle(n) : n.text }}</span
        >
      </button>
    </div>
    <Bubble v-if="dotTip && dotTipAt" :x="dotTipAt[0]" :y="dotTipAt[1]" :severity="dotTip.severity">
      {{ dotTip.text }}
    </Bubble>
    <Bubble v-if="hover" :x="hover.x" :y="hover.y">
      <b>{{ hover.title }}</b> {{ hover.value }}<span v-if="hover.detail" class="view3d-detail"> · {{ hover.detail }}</span>
      <div v-if="hoverRef" class="view3d-src">{{ displayRef(board, hoverRef) }}</div>
    </Bubble>
  </div>
</template>

<style scoped>
.view3d-ends,
.view3d-notes {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.view3d-end {
  position: absolute;
  left: 0;
  top: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--canvas-fg, #e6e6e6);
  font: 11px var(--mono, monospace);
  white-space: nowrap;
  pointer-events: auto;
  cursor: pointer;
}
.view3d-note-leads {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.view3d-note-leads path {
  fill: none;
  stroke: var(--drc-warn);
  stroke-width: 1;
  opacity: 0.8;
}
.view3d-note-leads path.error {
  stroke: var(--drc-err);
}
.view3d-note-leads path.info {
  stroke: var(--drc-info);
}
.view3d-note {
  --c: var(--drc-warn);
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  padding: 0;
  border: 0;
  background: none;
  font: 11px/15px var(--mono, ui-monospace, monospace);
  text-align: left;
  white-space: nowrap;
  pointer-events: auto;
  cursor: pointer;
}
.view3d-end .ring {
  position: absolute;
  left: -5px;
  top: -5px;
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--accent);
  border-radius: 50%;
  box-sizing: border-box;
}
.view3d-end .lbl {
  position: absolute;
  left: 8px;
  bottom: 4px;
  padding: 0 3px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--canvas-panel, #16181c) 80%, transparent);
}
.view3d-end.on {
  z-index: 1;
  opacity: 1;
  color: var(--accent);
}
.view3d-end.on .ring {
  border-color: var(--canvas-fg, #fff);
}
/* the tools sit at the foot of the pane, clear of the corner buttons and their popovers */
.view3d-edit :deep(.bv-edit) {
  top: auto;
  bottom: 8px;
}
.view3d-edit :deep(.bv-assist) {
  bottom: 46px;
}
.view3d-note.error {
  --c: var(--drc-err);
}
.view3d-note.info {
  --c: var(--drc-info);
}
.view3d-note .ring {
  position: absolute;
  left: -6px;
  top: -6px;
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--c);
  border-radius: 50%;
  box-sizing: border-box;
  background: radial-gradient(circle, var(--c) 0 1.5px, transparent 2px);
}
/* info is a hollow ring; an ERC finding sits on its part or pad as a diamond */
.view3d-note.info .ring {
  background: none;
}
.view3d-note.erc .ring {
  border-radius: 2px;
  transform: rotate(45deg) scale(0.85);
}
.view3d-note.line .ring {
  display: none;
}
.view3d-note .lbl {
  position: absolute;
  left: 0;
  top: 0;
  height: 15px;
  padding: 0 4px;
  border-radius: 3px;
  color: var(--c);
  background: color-mix(in srgb, var(--canvas-panel, #16181c) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  box-sizing: border-box;
  line-height: 13px;
}
.view3d-note .broken {
  width: 12px;
  height: 12px;
  margin-right: 3px;
  vertical-align: -2px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.view3d-note.focus .ring {
  border-width: 2.5px;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 35%, transparent);
}
.view3d-note.focus .lbl {
  border-color: var(--c);
}
.view3d-note.on {
  z-index: 1;
}
.view3d-note.on .lbl {
  width: max-content;
  max-width: 280px;
  height: auto;
  white-space: normal;
  padding: 1px 4px;
  border-color: var(--c);
  color: var(--canvas-fg, #e6e8ee);
}
.view3d-note.stale {
  opacity: 0.3;
  pointer-events: none;
}
.view3d {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--canvas, #0e1013);
}
.view3d :deep(.view3d-canvas) {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  touch-action: none;
}
.view3d :deep(.view3d-labels) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.view3d-buttons {
  position: absolute;
  top: 8px;
  right: 8px;
  max-width: calc(100% - 16px);
  flex-wrap: wrap;
  justify-content: flex-end;
  display: flex;
  gap: 4px;
  align-items: center;
  z-index: 1;
}
.view3d-buttons button {
  display: grid;
  place-items: center;
  width: 26px;
  flex-shrink: 0;
  height: 26px;
  padding: 0;
  border-radius: 4px;
  cursor: pointer;
  color: var(--fg, #e6e8ee);
  background: var(--panel, #1b1f27);
  border: 1px solid var(--line, #2b3140);
}
.view3d-buttons svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.view3d :deep(.view3d-callout) {
  font: 11px/1 var(--mono, ui-monospace, monospace);
  color: color-mix(in srgb, var(--c, var(--fg)) 60%, var(--fg, #e6e8ee));
  white-space: nowrap;
  pointer-events: auto;
  cursor: default;
  text-shadow:
    0 0 3px var(--bg, #14171d),
    0 0 2px var(--bg, #14171d);
  opacity: 0;
  transition: opacity 140ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.view3d :deep(.view3d-callout) {
  position: absolute;
  left: 0;
  top: 0;
  padding: 2px 4px;
  border-radius: 4px;
  will-change: transform;
}
.view3d :deep(.view3d-callout.on) {
  background: color-mix(in srgb, var(--panel, #1b1f27) 85%, transparent);
}
.view3d :deep(.view3d-leaders) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.view3d :deep(.view3d-leaders path) {
  fill: none;
  stroke: color-mix(in srgb, var(--c, var(--dim)) 60%, var(--fg, #e6e8ee));
  stroke-width: 1;
  transition: opacity 140ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.view3d-buttons button {
  transition:
    color 120ms cubic-bezier(0.25, 0.1, 0.25, 1),
    border-color 120ms cubic-bezier(0.25, 0.1, 0.25, 1),
    background-color 120ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.view3d-buttons button:hover {
  border-color: var(--accent, #7cc4ff);
}
.view3d-buttons button.on {
  color: var(--accent, #7cc4ff);
  border-color: var(--accent, #7cc4ff);
}
.view3d-sep {
  width: 6px;
}
.view3d-anchor {
  position: relative;
  display: grid;
}

.view3d-options {
  position: absolute;
  top: var(--options-top, 44px);
  right: 8px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  max-width: calc(100% - 16px);
  z-index: 3;
}
.view3d-options section {
  min-width: 0;
  width: 268px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--canvas-line);
  border-radius: 8px;
  color: var(--canvas-fg);
  background: var(--canvas-panel);
  box-shadow: 0 4px 16px #0002;
}
.view3d-options h3 {
  margin: 0 0 8px;
  font: 500 11px/1.2 var(--sans);
  color: var(--canvas-dim);
}
.view3d-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.view3d-row + .view3d-row {
  margin-top: 8px;
  flex-wrap: wrap;
}
.view3d-label {
  font-size: 11px;
  color: var(--canvas-dim);
}
.view3d-range {
  min-width: 0;
  width: 100%;
  flex: 1;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.view3d-val {
  min-width: 40px;
  font: 11px/1 var(--mono);
  color: var(--canvas-fg);
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.view3d-seg {
  display: flex;
  flex: 1;
  padding: 2px;
  gap: 2px;
  border: 1px solid var(--canvas-line);
  border-radius: 6px;
}
.view3d-seg button {
  flex: 1;
  border: 0;
  border-radius: 4px;
  padding: 5px 7px;
  background: transparent;
  color: var(--canvas-dim);
  font: 11px/1.2 var(--sans);
  cursor: pointer;
}
.view3d-seg button.on {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
}
.view3d-options .icon {
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  padding: 4px;
  border: 1px solid var(--canvas-line);
  border-radius: 5px;
  background: transparent;
  color: var(--canvas-dim);
  cursor: pointer;
}
.view3d-options .icon.on {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}
.view3d-options svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
}
.view3d-detail {
  opacity: 0.75;
}
.view3d-src {
  font-family: var(--mono);
  color: var(--accent);
}
.view3d-hint {
  color: var(--dim);
  font-size: 11px;
}
.view3d-tip {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  font-size: 12px;
  padding: 3px 7px;
  border-radius: 4px;
  white-space: nowrap;
  color: var(--fg, #e6e8ee);
  background: var(--panel, #1b1f27);
  border: 1px solid var(--line, #2b3140);
}
/* a finding's dot under the pointer: its rule, edged in its severity */
.view3d-dot-tip {
  max-width: 420px;
  white-space: normal;
  border-left: 3px solid var(--drc-warn);
}
.view3d-dot-tip.error {
  border-left-color: var(--drc-err);
}
.view3d-dot-tip.info {
  border-left-color: var(--drc-info);
}
</style>
