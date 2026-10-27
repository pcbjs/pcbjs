// @pcbjs/lsp: the language server the dev server loads when an editor asks for it. docs/ide-bridge.md has the protocol.
export { startLanguageServer, toUri, toFile, type BoardRef, type Provider, type LanguageServer, type SelectRange, type CursorTarget } from './server.js';
export { targetAt, padSource, type Target, type TargetKind, type BoardTarget } from './target.js';
export { projects, type Inject, type Injected, type Projects } from './project.js';
export { messageChannel, isRpcMessage, isInitialize, type MessageChannel } from './channel.js';
export * from './protocol.js';
export { segmentsOf, typedSegment, type RawSegment, type RawPresentation, type SegmentContext, type PadFact } from './segments.js';
export { detect, hitAt, encodeValue, routeCalls, type Hit, type Kind } from './detect.js';
export { renderPreview, padItems, WIDTH as PREVIEW_WIDTH, type Preview, type PreviewSpec } from './preview.js';
export { hoverPreview, imageMarkdown, type HoverPreview, type PreviewContext } from './hover-preview.js';
export { repair, toOverlay, type Repaired, type Span } from './repair.js';
