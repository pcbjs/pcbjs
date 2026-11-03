declare module 'virtual:pcbjs/board' {
  /** each board target compiled, as its facets, in entry order */
  export const boards: import('@pcbjs/core/site-facets').FacetSet[]
  /** true when there is one entry */
  export const single: boolean
  /** the last compile error of each entry, keyed by entry path */
  export const errors: Record<string, string | null>
  /** the entry of each board, keyed by board name */
  export const entries: Record<string, string>
  /** a workspace dev server's scopes, null for one project */
  export const workspace: import('@pcbjs/core/protocol').ScopesMsg | null
  /** dev: the run of the session's snapshot the boards are from, and the compile status when the module was made */
  export const run: number | null
  export const status: import('@pcbjs/core/protocol').LoadStatus | null
}
declare module '*?raw' {
  const text: string
  export default text
}
