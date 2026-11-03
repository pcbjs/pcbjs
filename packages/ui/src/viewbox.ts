// the pan and zoom of the 2D and schematic views; every length is in the drawing's own unit, mm
import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import { Spring } from './scene/motion'

export type Box = [number, number, number, number]

/** A view box with the aspect of its element: spring moves, wheel zoom and drag pan. `maxW` is the widest it may zoom out to. */
export function useViewBox(svg: Ref<SVGSVGElement | null>, start: Box, maxW: () => number) {
  const size = ref({ w: 0, h: 0 })
  const vb = ref<Box>([...start] as Box)
  // per screen pixel; the view box always has the aspect of the element, so one number covers both axes
  const px = computed(() => (size.value.w ? vb.value[2] / size.value.w : vb.value[2] / 800))

  function fitBox(b: Box): Box {
    const { w: cw, h: ch } = size.value
    if (!cw || !ch) return [...b] as Box
    const a = cw / ch
    const W = Math.max(b[2], b[3] * a),
      H = W / a
    return [b[0] + b[2] / 2 - W / 2, b[1] + b[3] / 2 - H / 2, W, H]
  }
  // the centre and the log of the width follow springs as in 3D; panning, the wheel and a resize stop them
  const springs = { x: new Spring(0), y: new Spring(0), lw: new Spring(0) }
  let aspect = 1,
    raf = 0,
    last = 0
  const boxOf = (): Box => {
    const w = Math.exp(springs.lw.value),
      h = w * aspect
    return [springs.x.value - w / 2, springs.y.value - h / 2, w, h]
  }
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const moving = [springs.x.step(dt), springs.y.step(dt), springs.lw.step(dt)].some(Boolean)
    vb.value = boxOf()
    raf = moving ? requestAnimationFrame(frame) : 0
  }
  function animateTo(b: Box) {
    if (!raf) {
      const [x, y, w] = vb.value
      springs.x.snap(x + w / 2)
      springs.y.snap(y + vb.value[3] / 2)
      springs.lw.snap(Math.log(w))
    }
    aspect = b[3] / b[2]
    springs.x.set(b[0] + b[2] / 2)
    springs.y.set(b[1] + b[3] / 2)
    springs.lw.set(Math.log(b[2]))
    if (!raf) {
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
  }
  function stopAnimation() {
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
  /** Where the frame is heading: the animation's target while one runs, else the frame itself. */
  function targetBox(): Box {
    if (!raf) return vb.value
    const w = Math.exp(springs.lw.target),
      h = w * aspect
    return [springs.x.target - w / 2, springs.y.target - h / 2, w, h]
  }
  onBeforeUnmount(stopAnimation)

  /** Jump or move to a box, grown to the element's aspect. */
  function show(b: Box, animate = true) {
    const f = fitBox(b)
    if (animate && size.value.w) animateTo(f)
    else {
      stopAnimation()
      vb.value = f
    }
  }
  function zoomAt(x0: number, y0: number, k: number, animate = false) {
    const [x, y, w, h] = animate ? targetBox() : vb.value
    const nw = w * k
    if ((k < 1 && nw < 0.5) || (k > 1 && nw > maxW())) return
    const b: Box = [x0 - (x0 - x) * k, y0 - (y0 - y) * k, nw, h * k]
    if (animate) animateTo(b)
    else {
      stopAnimation()
      vb.value = b
    }
  }
  function zoomBy(k: number) {
    const [x, y, w, h] = targetBox()
    zoomAt(x + w / 2, y + h / 2, k, true)
  }

  /** Client pixels to view box coordinates. */
  function toView(e: { clientX: number; clientY: number }): [number, number] {
    const r = svg.value!.getBoundingClientRect()
    const [x, y, w, h] = vb.value
    return [x + ((e.clientX - r.left) / r.width) * w, y + ((e.clientY - r.top) / r.height) * h]
  }
  function onWheel(e: WheelEvent) {
    const [x, y] = toView(e)
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    zoomAt(x, y, Math.exp(Math.max(-60, Math.min(60, d)) * 0.004))
  }
  /** A later resize keeps the scale and the centre. */
  function resize(w: number, h: number) {
    stopAnimation()
    const prev = size.value,
      s = vb.value[2] / prev.w
    const [x, y, vw, vh] = vb.value
    size.value = { w, h }
    vb.value = [x + vw / 2 - (w * s) / 2, y + vh / 2 - (h * s) / 2, w * s, h * s]
  }

  // a press that moves more than a few pixels pans, otherwise it is a click
  let drag: { x: number; y: number; vb: Box; moved: boolean } | null = null
  function press(e: PointerEvent) {
    if (e.button === 0) drag = { x: e.clientX, y: e.clientY, vb: [...vb.value] as Box, moved: false }
  }
  /** True while the press pans. */
  function pan(e: PointerEvent): boolean {
    if (!drag) return false
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) > 3) {
      stopAnimation()
      drag.vb = [...vb.value] as Box
      drag.moved = true
      svg.value!.setPointerCapture(e.pointerId)
    }
    if (!drag.moved) return false
    const s = px.value
    vb.value = [drag.vb[0] - dx * s, drag.vb[1] - dy * s, drag.vb[2], drag.vb[3]]
    return true
  }
  /** Ends a press; true when it was a click. */
  function release(): boolean {
    const click = !!drag && !drag.moved
    drag = null
    return click
  }
  const panning = () => !!drag?.moved

  return { size, vb, px, fitBox, animateTo, stopAnimation, show, zoomAt, zoomBy, toView, onWheel, resize, press, pan, release, panning }
}
