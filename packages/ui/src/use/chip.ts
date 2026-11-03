// The selection chip: the anchor's path, each segment ascending to it, every other member, the isolation's words, where the anchor
// is placed or defined, and the context menu that sends the selection to an agent.
import { computed, ref } from 'vue'
import type { PaneContext } from '../context'
import { load, save } from '../context'
import { chipPath, isolationLabel, partOfRef, partRefOf, selectRefs } from '../selection'
import { displayRef } from '../refs'
import { refSource } from '../defs'
import { agentChoices, sendRequest, type LastAgent } from '../agents'
import { targetName } from '../variants'
import type { SourceKind, SourceTarget } from '../source'

export const MAX_CHIPS = 5
const LAST_AGENT = 'pcbjs.lastAgent'
const NO_AGENTS = { list: [], send: null }

export function useChip(ctx: PaneContext) {
  const { board: store, pane } = ctx
  const agents = ctx.shell?.agents ?? NO_AGENTS
  const sel = computed(() => store.sel)
  const displaySite = computed(() => pane.mode !== 'checks' ? store.layoutSite : store.site)
  const label = (ref: string) => displaySite.value ? displayRef(displaySite.value, ref) : ref
  const anchorPath = computed(() => (displaySite.value && sel.value.anchor ? chipPath(displaySite.value, sel.value.anchor) : []))
  const others = computed(() => sel.value.refs.filter(r => r !== sel.value.anchor).reverse())
  const gone = computed(() => new Set(store.drawn?.missing ?? []))
  function ascend(ref: string) {
    store.setSel(selectRefs({ ...sel.value, level: null }, [ref]))
  }
  /** Where the anchor is placed or defined, in the view the pane shows. */
  const sourceSite = displaySite
  const anchorSource = (kind: SourceKind): SourceTarget | null => (sourceSite.value && sel.value.anchor ? refSource(sourceSite.value, sel.value.anchor, kind, pane.mode === 'sch') : null)
  const openPlace = computed(() => anchorSource('placement'))
  const openDef = computed(() => {
    const d = anchorSource('definition'),
      p = openPlace.value
    return d && (!p || d.file !== p.file || d.start[0] !== p.start[0] || d.start[1] !== p.start[1]) ? d : null
  })
  function openAnchor(kind: SourceKind) {
    const b = store.site,
      t = kind === 'placement' ? openPlace.value : openDef.value
    const a = sel.value.anchor
    const part = b ? partOfRef(b, a) : null
    const pad =
      t && b && a && part && kind === 'placement' && pane.mode !== 'sch' && a !== partRefOf(b, part)
        ? { ...t, pad: `${part}/${a.slice(a.lastIndexOf('/') + 1)}`, board: b.name }
        : t
    if (b) void ctx.open(pad)
  }
  const isoCount = computed(() => sel.value.isolate?.instances.length ?? 0)
  /** the chip's words in an isolation: `LedChannelRow, shown with CH1's values, 3 instances follow` */
  const isoLabel = computed(() => (store.site && sel.value.isolate ? isolationLabel(store.site, sel.value.isolate) : null))

  // the context menu: Send to agent, while an agent is attached; an editor's pane hands it to the extension, a standalone page asks here
  const chipMenu = ref(false)
  const sendBox = ref<{ to: string; comment: string; now: number } | null>(null)
  const canSend = computed(() => agents.list.length > 0 && sel.value.refs.length > 0)
  const inPane = () => !!ctx.shell?.ide.on && window.parent !== window
  const lastAgent = (): LastAgent | null => {
    try {
      return JSON.parse(load(LAST_AGENT) ?? 'null')
    } catch {
      return null
    }
  }
  const agentList = computed(() => agentChoices(agents.list, lastAgent()))
  function openChipMenu() {
    sendBox.value = null
    chipMenu.value = true
    document.addEventListener('pointerdown', () => (chipMenu.value = false), { once: true })
  }
  function sendToAgent() {
    chipMenu.value = false
    const b = store.site
    if (!b || !canSend.value) return
    const req = sendRequest(b.name, targetName(b), sel.value)
    if (inPane()) window.parent.postMessage({ type: 'pcbjs:send', ...req }, '*')
    else if (agents.send) sendBox.value = { to: agentList.value[0].client, comment: '', now: Date.now() }
  }
  function submitSend() {
    const b = store.site,
      box = sendBox.value
    const to = agents.list.find(a => a.client === box?.to)
    sendBox.value = null
    if (!b || !box || !to || !agents.send) return
    save(LAST_AGENT, JSON.stringify({ client: to.client, name: to.name }))
    agents.send(to.client, sendRequest(b.name, targetName(b), sel.value), box.comment)
  }
  return { sel, label, anchorPath, others, gone, ascend, openPlace, openDef, openAnchor, isoCount, isoLabel, chipMenu, sendBox, canSend, agentList, openChipMenu, sendToAgent, submitSend }
}
