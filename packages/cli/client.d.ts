// The types of the `?pcb:` imports, as vite/client types `?raw`: name it in `types` of a tsconfig or a triple-slash reference.
// A pattern matches the end of the specifier, so an import with `&target=` is untyped unless the site declares it.

declare module '*?pcb:meta' {
  const data: import('@pcbjs/core/site-facets').FacetData['meta']
  export default data
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:sch' {
  const data: import('@pcbjs/core/site-facets').FacetData['sch']
  export default data
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:layers' {
  const data: import('@pcbjs/core/site-facets').FacetData['layers']
  export default data
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:shapes' {
  const data: import('@pcbjs/core/site-facets').FacetData['shapes']
  export default data
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:model' {
  const data: import('@pcbjs/core/site-facets').FacetData['model']
  export default data
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:findings' {
  const data: import('@pcbjs/core/site-facets').FacetData['findings']
  export default data
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:fab' {
  const data: import('@pcbjs/core/site-facets').FacetData['fab']
  export default data
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:board' {
  const board: import('@pcbjs/core/site-facets').BoardRef
  export default board
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:poster' {
  const url: string
  export default url
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:poster&view=sch' {
  const url: string
  export default url
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
declare module '*?pcb:module' {
  const module: import('@pcbjs/compile/browser').BrowserModule
  export default module
  export const header: import('@pcbjs/core/site-facets').FacetHeader
}
