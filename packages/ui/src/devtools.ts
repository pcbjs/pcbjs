// Semantic UI snapshots are independent of Vue internals and never serialize source documents.
export interface UiNode {
  id: string
  parent: string | null
  depth: number
  label: string
  component: string | null
  source: string | null
  properties: Record<string, unknown>
  element: Element
}
const semantic = '[data-ui],button,input,select,textarea,a[href],[role],summary,canvas'
const excluded = '[data-ui-inspector]'

export function uiTree(root: Element): UiNode[] {
  const result: UiNode[] = []
  const parents = new Map<Element, UiNode>()
  for (const el of [root, ...root.querySelectorAll(semantic)]) {
    if (result.length >= 600) break
    if (el.closest(excluded) || !el.getClientRects().length) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    let up = el.parentElement
    while (up && up !== root.parentElement && !parents.has(up)) up = up.parentElement
    const parent = up ? parents.get(up) : undefined
    const component = el.getAttribute('data-ui') ?? el.closest('[data-ui]')?.getAttribute('data-ui') ?? null
    const rect = el.getBoundingClientRect()
    const attributes = Object.fromEntries([...el.attributes].filter(a => /^(aria-|data-ui|role$|title$|type$)/.test(a.name)).map(a => [a.name, a.value]))
    const control = el as HTMLInputElement
    const node: UiNode = {
      id: `ui-${result.length}`,
      parent: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      label:
        el.getAttribute('data-ui') ??
        el.getAttribute('aria-label') ??
        el.getAttribute('title') ??
        (el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 64) || el.tagName.toLowerCase()),
      component,
      source: el.closest('[data-ui-source]')?.getAttribute('data-ui-source') ?? null,
      properties: {
        tag: el.tagName.toLowerCase(),
        classes: el.getAttribute('class'),
        ...attributes,
        ...('disabled' in el ? { disabled: control.disabled } : {}),
        ...('value' in el ? { value: control.value } : {}),
        ...('checked' in el ? { checked: control.checked } : {}),
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        style: { display: style.display, position: style.position, zIndex: style.zIndex, opacity: style.opacity },
      },
      element: el,
    }
    parents.set(el, node)
    result.push(node)
  }
  return result
}

export const uiSnapshot = (nodes: UiNode[]) => nodes.map(({ element, ...node }) => node)
