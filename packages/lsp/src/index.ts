// @pcbjs/lsp: the language server the dev server loads when an editor asks for it. docs/ide-bridge.md has the protocol.
export { startLanguageServer, type LanguageServer } from './server.js'
export { toUri, toFile, type BoardRef, type BoardSource, type EditorEvents, type Host, type ProjectAssist } from './host.js'
export { selectParams, type SelectRange, type EditorSelection } from './selection.js'
export { targetAt, padSource, type Target, type TargetKind, type BoardTarget } from './target.js'
export { documentStore, realFile, type Doc, type DocChange, type DocRole, type DocumentStore, type Holder } from './documents.js'
export { projects, sessionProjects, type Inject, type Injected, type Projects } from './project.js'
export { messageChannel, isRpcMessage, isInitialize, type MessageChannel } from './channel.js'
export * from './protocol.js'
export { segmentsOf, typedSegment, type RawSegment, type RawPresentation, type SegmentContext, type PadFact } from './segments.js'
export { detect, hitAt, encodeValue, routeCalls, type Hit, type Kind } from './detect.js'
export { docOf, parse, type DocModel } from './doc.js'
export { renderPreview, padItems, WIDTH as PREVIEW_WIDTH, type Preview, type PreviewSpec } from './preview.js'
export { hoverPreview, imageMarkdown, type HoverPreview, type PreviewContext } from './hover-preview.js'
export { repair, cutCalls, toOverlay, type Repaired, type Span } from './repair.js'
export { blockAt, blockError, changedBlock, changedSpan, type Block } from './hold.js'
export { assistSpot, assistContexts, endCompletions, endEdit, ASSIST_COMMANDS, type AssistSpot, type CodeScope, type ScopeValue } from './assist.js'
export { codeScope } from './scope.js'
export {
  elementAt,
  writeAt,
  atRotation,
  setAt,
  addChild,
  setSide,
  setLocked,
  lockReason,
  setGrid,
  chainCallAt,
  routeLayer,
  movePoint,
  keepPoint,
  insertWaypoint,
  insertPoint,
  deleteCall,
  chainEndOf,
  diffEdit,
  textDoc,
  toPosition,
  toSite,
  toRange,
  type TextDoc,
  type Site,
  type OffsetEdit as SourceEdit,
  type Element as PlacementElement,
  type ChainCall,
  type AtStyle,
} from './edits.js'
