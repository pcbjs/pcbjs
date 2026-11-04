/// <reference types="vite/client" />
/// <reference types="@zhangyx1998/svg-loader/client" />

declare module 'virtual:site-boards' {
  import type { BoardRef } from '@pcbjs/core/site-facets'
  /** every board the site shows by page id, as its `?pcb:board` import; config.mts */
  const boards: Record<string, BoardRef>
  export default boards
}

declare module 'virtual:guide-boards' {
  import type { BoardRef } from '@pcbjs/core/site-facets'
  const boards: Record<string, BoardRef>
  export default boards
}
