// What a board page says about its board: the check summary, the compile error or the stale board kept, the draft, the stackup and the
// compile times.
import { computed } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import type { Tab } from '../pane'
import { checkSummary } from '../variants'
import { stackupRows } from '../stackup'

/** The DRC pill of a board: its summary, and the tab it opens, ERC when only the ERC has findings. */
export function drcPill(b: SiteData) {
  const s = checkSummary(b)
  const tab: Tab = !s.drc.errors && !s.drc.warnings && !s.unconnected && s.erc.errors + s.erc.warnings ? 'erc' : 'drc'
  return { summary: s, tab }
}

/** The compile error of a board shown, or of its stale board kept: a head to the first line that says something, and the rest. */
export function useStatus(site: () => SiteData | null, error: () => string | null) {
  // a board whose last compile failed stays on show, marked stale: in dev the entry's error, in a built site the board's own
  const staleText = computed(() => {
    const b = site()
    return b ? (error() ?? (b.stale || b.halted ? (b.staleError ?? 'the last compile failed') : null)) : null
  })
  const errorText = computed(() => staleText.value ?? error() ?? '')
  // compiled from the editor's unsaved text, with the statements its repair skipped
  const draftText = computed(() => {
    const n = site()?.draft?.skipped
    return n === undefined ? null : n ? `draft, ${n} statement${n > 1 ? 's' : ''} skipped` : 'draft'
  })
  // the head runs to the first line that says something: Vite's "Transform failed with 1 error:" takes the line after it along
  const headLines = computed(() => {
    const ls = errorText.value.split('\n')
    let n = 1
    while (n < ls.length && /:\s*$/.test(ls[n - 1]) && ls[n].trim()) n++
    return n
  })
  const errorHead = computed(() => errorText.value.split('\n').slice(0, headLines.value).join('\n'))
  const errorBody = computed(() => errorText.value.split('\n').slice(headLines.value).join('\n').replace(/^\n+/, ''))
  // the board's outline for the placeholder the prerendered page shows until the 2D view mounts
  const outlinePath = computed(
    () =>
      site()
        ?.outline.map(r => 'M' + r.map(p => p.join(' ')).join('L') + 'Z')
        .join('') ?? '',
  )
  return { staleText, draftText, errorHead, errorBody, outlinePath }
}

export const stackOf = (b: SiteData | null) => (b?.stackup ? stackupRows(b.stackup) : [])
export const timingRows = (b: SiteData | null) => Object.entries(b?.timings ?? {}).filter(([, v]) => typeof v === 'number' && v >= 0.5) as [string, number][]
