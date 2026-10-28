// The pcbjs additions to LSP: handshake, custom messages, segments. docs/ide-bridge.md describes them; a client may import this module alone.

/** Additive: a server answers every protocol from 1 up to its own. */
export const PROTOCOL = 2
/** Bumped only by a change an older peer cannot survive. */
export const MAJOR = 1

/** Kinds are only ever added, never renamed or removed. */
export const KINDS = ['number', 'length', 'angle', 'position', 'layer', 'enum', 'pathCommand', 'pinRef'] as const
export type SegmentKind = (typeof KINDS)[number]
export const KIND_SINCE: Record<SegmentKind, number> = { number: 1, length: 1, angle: 1, position: 1, layer: 1, enum: 1, pathCommand: 1, pinRef: 1 }

/** Client capabilities this server acts on. `widget`: the client renders any kind from its `widget`. */
export const CLIENT_CAPABILITIES = ['widget'] as const

export const METHODS = {
  focus: 'pcbjs/focus',
  select: 'pcbjs/select',
  preview: 'pcbjs/preview',
  segments: 'pcbjs/segments',
} as const

export interface Position {
  line: number
  character: number
}
export interface Range {
  start: Position
  end: Position
}
export interface TextEdit {
  range: Range
  newText: string
}

/** `initializationOptions.pcbjs`; every field optional. */
export interface ClientHello {
  /** 1 when absent */
  protocol?: number
  /** 1 when absent */
  major?: number
  /** every kind of its protocol when absent */
  kinds?: string[]
  capabilities?: string[]
  name?: string
  version?: string
}

/** `capabilities.experimental.pcbjs` of the answer. */
export interface ServerHello {
  /** the lower of the client's and the server's */
  protocol: number
  major: number
  kinds: SegmentKind[]
  /** the client capabilities this server honours for this client */
  capabilities: string[]
  methods: string[]
  version: string
}

export interface FocusParams {
  textDocument: { uri: string }
  position: Position
  selection?: Range
}

export interface SelectParams {
  uri: string
  range: Range
}

export interface PreviewParams {
  /** without `ide` or `theme`, which the client adds */
  url: string
  scope?: string | null
}

export interface SegmentsParams {
  textDocument: { uri: string }
  range?: Range
  position?: Position
  /** a typed value for the segment at `position`, as `colorPresentation` takes a colour */
  value?: string
}

export interface Constraints {
  unit?: string
  min?: number
  max?: number
  step?: number
  choices?: string[]
  grammar?: 'route' | 'svg' | 'chain'
  index?: number
}

/** How a client edits a segment, so a new kind needs no client change. A client treats an unknown `input` as `text`. */
export interface Widget {
  input: 'number' | 'length' | 'angle' | 'position' | 'layer' | 'enum' | 'text' | 'none'
  /** whether a typed value is accepted; the server checks it through `pcbjs/segments` with `value` */
  typed: boolean
  prompt?: string
  options?: string[]
  unit?: string
  min?: number
  max?: number
  step?: number
  /** a CSS colour to show beside the value */
  preview?: string
}

export interface Presentation {
  label: string
  detail?: string
  edit: TextEdit
}

export interface Segment {
  range: Range
  kind: SegmentKind
  value: string
  label: string
  constraints: Constraints
  presentations: Presentation[]
  widget?: Widget
  /** set when a typed `value` cannot be written; `presentations` is then empty */
  error?: string
}

const PROMPTS: Record<SegmentKind, { input: Widget['input']; prompt?: string }> = {
  number: { input: 'number', prompt: 'a number' },
  length: { input: 'length', prompt: 'a length, mm unless a unit follows: 0.25, 10mil' },
  angle: { input: 'angle', prompt: 'an angle, degrees unless a unit follows' },
  position: { input: 'position', prompt: 'x y and an optional rotation or layer' },
  layer: { input: 'layer', prompt: 'a layer name or alias' },
  enum: { input: 'enum' },
  pathCommand: { input: 'text', prompt: 'the command, such as H 9, @B.Cu or XZ; empty deletes it' },
  pinRef: { input: 'text', prompt: 'a pad number or name' },
}

export function widgetOf(kind: SegmentKind, c: Constraints): Widget {
  const { input, prompt } = PROMPTS[kind]
  const w: Widget = { input, typed: input !== 'enum' }
  if (prompt) w.prompt = prompt
  if ((input === 'enum' || input === 'layer') && c.choices) w.options = c.choices
  for (const k of ['unit', 'min', 'max', 'step'] as const) if (c[k] !== undefined) (w as any)[k] = c[k]
  return w
}

const int = (v: unknown, d: number) => (Number.isInteger(v) ? (v as number) : d)

export function negotiate(hello: ClientHello | undefined, serverVersion: string): ServerHello {
  const protocol = Math.max(1, Math.min(PROTOCOL, int(hello?.protocol, 1)))
  const capabilities = Array.isArray(hello?.capabilities) && protocol >= 2 ? CLIENT_CAPABILITIES.filter(c => hello!.capabilities!.includes(c)) : []
  const listed = Array.isArray(hello?.kinds) ? hello!.kinds.filter((k): k is SegmentKind => (KINDS as readonly string[]).includes(k)) : undefined
  const kinds = capabilities.includes('widget') ? [...KINDS] : (listed ?? KINDS.filter(k => KIND_SINCE[k] <= protocol))
  return { protocol, major: MAJOR, kinds, capabilities, methods: Object.values(METHODS), version: serverVersion }
}

/** As it is when the client knows the kind, as `enum` when it knows that, else nothing. */
export function forClient(seg: Segment, kinds: readonly SegmentKind[]): Segment | undefined {
  if (kinds.includes(seg.kind)) return seg
  if (kinds.includes('enum')) return { ...seg, kind: 'enum', constraints: {}, widget: { input: 'enum', typed: false } }
  return undefined
}
