// The theme of a component outside the app: light, dark, high contrast, or auto following `html.dark` as VitePress sets it, the
// page's own data-theme, else the system; resolved after mount only, so the server and the first client render agree.
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import type { ViewPrefs } from './context'

export type ThemeName = 'light' | 'dark' | 'hc' | 'auto'

function pageDark(): boolean {
  const el = document.documentElement
  if (el.classList.contains('dark') || el.dataset.theme === 'dark') return true
  if (el.dataset.theme === 'light') return false
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** The attributes the component's root takes, `data-theme` and `data-contrast`; the views' preferences follow so they draw in it. */
export function useTheme(theme: () => ThemeName | undefined, prefs: Pick<ViewPrefs, 'theme'>) {
  const dark = ref<boolean | null>(null)
  let stop = () => {}
  onMounted(() => {
    const read = () => (dark.value = pageDark())
    read()
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    const seen = new MutationObserver(read)
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    media?.addEventListener('change', read)
    stop = () => {
      seen.disconnect()
      media?.removeEventListener('change', read)
    }
  })
  onBeforeUnmount(() => stop())
  const resolved = computed<'light' | 'dark' | null>(() => {
    const t = theme() ?? 'auto'
    if (t === 'light' || t === 'dark') return t
    if (t === 'hc') return 'dark'
    return dark.value === null ? null : dark.value ? 'dark' : 'light'
  })
  watchEffect(() => {
    if (resolved.value) prefs.theme = resolved.value
  })
  return computed(() => ({ 'data-theme': resolved.value ?? undefined, 'data-contrast': theme() === 'hc' ? 'high' : undefined }))
}
