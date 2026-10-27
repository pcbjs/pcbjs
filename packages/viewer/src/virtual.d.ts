declare module 'virtual:pcbjs/board' {
  import type { SiteData } from '@pcbjs/core/site-data'
  /** the first board, for single-board clients such as dev3d.ts */
  const data: SiteData | null
  export default data
  export const error: string | null
  /** the compiled boards in entry order */
  export const boards: SiteData[]
  /** true when there is one entry */
  export const single: boolean
  /** the last compile error of each entry, keyed by entry path */
  export const errors: Record<string, string | null>
  /** the entry of each board, keyed by board name */
  export const entries: Record<string, string>
  /** a workspace dev server's scopes, null for one project */
  export const workspace: import('./state').WorkspaceInfo | null
}
declare module '*?raw' {
  const text: string
  export default text
}
