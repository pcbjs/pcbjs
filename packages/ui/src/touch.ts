import { onBeforeUnmount, onMounted, type Ref } from 'vue'

type Point = [number, number]
const owners = new WeakMap<Element, HTMLElement>()
export interface Pinch {
  from: Point
  to: Point
  scale: number
}

/** Own a two-finger gesture across the canvas and its overlays until every finger lifts. */
export function usePinch(host: Ref<HTMLElement | null | undefined>, start: () => void, move: (pinch: Pinch) => void) {
  let surface: HTMLElement
  const points = new Map<number, { at: Point; target: Element }>()
  let active = false,
    canceling = false,
    blockClick = false
  let previous: { center: Point; distance: number } | null = null
  const sample = () => {
    const [a, b] = [...points.values()].map(p => p.at)
    return b ? { center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Point, distance: Math.hypot(a[0] - b[0], a[1] - b[1]) } : null
  }
  const consume = (e: Event) => {
    if (e.cancelable) e.preventDefault()
    e.stopImmediatePropagation()
  }
  function down(e: PointerEvent) {
    if (!points.size) blockClick = false
    if (e.pointerType !== 'touch') return
    if (!points.size) {
      const el = host.value!
      if (owners.has(surface) && owners.get(surface) !== el) return
      const canvas = (e.target as Element).closest('.board-view, .sch-view, .view3d')
      if (canvas && canvas !== el) return
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
      owners.set(surface, el)
    }
    points.set(e.pointerId, { at: [e.clientX, e.clientY], target: e.target as Element })
    if (points.size < 2) return
    if (!active) {
      canceling = true
      for (const [id, p] of points) {
        if (id === e.pointerId) continue
        p.target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch', pointerId: id }))
        if (p.target.hasPointerCapture(id)) p.target.releasePointerCapture(id)
      }
      canceling = false
      active = blockClick = true
      start()
    }
    for (const id of points.keys()) host.value?.setPointerCapture(id)
    previous = sample()
    consume(e)
  }
  function moving(e: PointerEvent) {
    const p = points.get(e.pointerId)
    if (!p) return
    p.at = [e.clientX, e.clientY]
    if (!active) return
    const next = sample()
    if (next && previous && next.distance > 0 && previous.distance > 0) move({ from: previous.center, to: next.center, scale: previous.distance / next.distance })
    previous = next
    consume(e)
  }
  function end(e: PointerEvent) {
    if (canceling || !points.delete(e.pointerId)) return
    if (active) {
      consume(e)
      if (host.value?.hasPointerCapture(e.pointerId)) host.value.releasePointerCapture(e.pointerId)
    }
    previous = sample()
    if (!points.size) {
      active = false
      owners.delete(surface)
    }
  }
  const click = (e: MouseEvent) => {
    if (blockClick && e.detail) consume(e)
  }
  const touch = (e: TouchEvent) => {
    if ((active || e.touches.length > 1) && e.cancelable) e.preventDefault()
  }
  const gesture = (e: Event) => {
    if (e.cancelable) e.preventDefault()
  }
  let dispose = () => {}
  onMounted(() => {
    const el = (surface = host.value!.closest<HTMLElement>('.stage, .pcbjs-view') ?? host.value!)
    const doc = el.ownerDocument
    el.addEventListener('pointerdown', down, true)
    doc.addEventListener('pointermove', moving, true)
    doc.addEventListener('pointerup', end, true)
    doc.addEventListener('pointercancel', end, true)
    el.addEventListener('click', click, true)
    el.addEventListener('dblclick', click, true)
    el.addEventListener('touchstart', touch, { passive: false, capture: true })
    el.addEventListener('touchmove', touch, { passive: false, capture: true })
    el.addEventListener('gesturestart', gesture)
    el.addEventListener('gesturechange', gesture)
    dispose = () => {
      el.removeEventListener('pointerdown', down, true)
      doc.removeEventListener('pointermove', moving, true)
      doc.removeEventListener('pointerup', end, true)
      doc.removeEventListener('pointercancel', end, true)
      el.removeEventListener('click', click, true)
      el.removeEventListener('dblclick', click, true)
      el.removeEventListener('touchstart', touch, true)
      el.removeEventListener('touchmove', touch, true)
      el.removeEventListener('gesturestart', gesture)
      el.removeEventListener('gesturechange', gesture)
      for (const id of points.keys()) if (host.value?.hasPointerCapture(id)) host.value.releasePointerCapture(id)
      points.clear()
      if (owners.get(surface) === host.value) owners.delete(surface)
    }
  })
  onBeforeUnmount(() => dispose())
}
