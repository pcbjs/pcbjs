import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** Recover a canvas gesture when its release is lost, without turning cancellation into a click. */
export function usePointer(host: Ref<HTMLElement | null | undefined>, cancel: (e: PointerEvent | null) => void, leave: () => void) {
  let dispose = () => {}
  onMounted(() => {
    const el = host.value!,
      doc = el.ownerDocument,
      win = doc.defaultView!
    let press: PointerEvent | null = null
    const inside = (e: PointerEvent) => pointerInside(el, e)
    const reset = () => {
      const e = press
      press = null
      cancel(e)
      const target = (e?.target as Element | null)?.closest('svg.board-svg, svg.sch-svg, canvas.view3d-canvas')
      if (e && target?.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
      leave()
    }
    const down = (e: PointerEvent) => {
      if (!(e.target as Element).closest('svg.board-svg, svg.sch-svg, canvas.view3d-canvas')) return
      if (press) {
        if (e.pointerType !== 'touch') e.stopImmediatePropagation()
        return
      }
      press = e
    }
    const move = (e: PointerEvent) => {
      if (press?.pointerId === e.pointerId && e.pointerType !== 'touch' && !(e.buttons & (1 << (press.button === 1 ? 2 : press.button === 2 ? 1 : 0)))) reset()
    }
    const boundary = (e: PointerEvent) => {
      if (!inside(e)) leave()
    }
    const up = (e: PointerEvent) => {
      if (press?.pointerId !== e.pointerId || press.button !== e.button) return
      if (!el.contains(e.target as Node)) reset()
      else press = null
    }
    const canceled = (e: PointerEvent) => {
      if (press?.pointerId === e.pointerId) reset()
    }
    const filter = (e: PointerEvent) => {
      if (press && (press.pointerId !== e.pointerId || (e.type === 'pointerup' && press.button !== e.button))) e.stopImmediatePropagation()
    }
    const exit = (e: PointerEvent) => {
      if (!e.relatedTarget) leave()
    }
    const visibility = () => {
      if (doc.hidden) reset()
    }
    el.addEventListener('pointerdown', down, true)
    el.addEventListener('lostpointercapture', canceled)
    el.addEventListener('pointermove', filter, true)
    el.addEventListener('pointerup', filter, true)
    doc.addEventListener('pointermove', move, true)
    doc.addEventListener('pointermove', boundary)
    doc.addEventListener('pointerup', up)
    doc.addEventListener('pointercancel', canceled, true)
    doc.addEventListener('pointerout', exit)
    doc.addEventListener('pointerleave', leave)
    win.addEventListener('blur', reset)
    doc.addEventListener('visibilitychange', visibility)
    dispose = () => {
      reset()
      el.removeEventListener('pointerdown', down, true)
      el.removeEventListener('lostpointercapture', canceled)
      el.removeEventListener('pointermove', filter, true)
      el.removeEventListener('pointerup', filter, true)
      doc.removeEventListener('pointermove', move, true)
      doc.removeEventListener('pointermove', boundary)
      doc.removeEventListener('pointerup', up)
      doc.removeEventListener('pointercancel', canceled, true)
      doc.removeEventListener('pointerout', exit)
      doc.removeEventListener('pointerleave', leave)
      win.removeEventListener('blur', reset)
      doc.removeEventListener('visibilitychange', visibility)
    }
  })
  onBeforeUnmount(() => dispose())
}

export function pointerInside(el: Element | null | undefined, e: { clientX: number; clientY: number }): boolean {
  const r = el?.getBoundingClientRect()
  return !!r && e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom
}
