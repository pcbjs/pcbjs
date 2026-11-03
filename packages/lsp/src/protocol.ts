// The language server's side of the pcbjs additions to LSP: the widget of each segment kind and the handshake's answer. The messages
// themselves are @pcbjs/core/protocol's; docs/ide-bridge.md describes them.
import { MAJOR, METHODS, PROTOCOL, type ClientHello, type Constraints, type SegmentKind, type ServerHello, type Widget } from '@pcbjs/core/protocol'

/** Client capabilities this server acts on: `tokens`, a client that colours `pcbjs/tokens` itself and takes no semantic tokens. */
export const CLIENT_CAPABILITIES: readonly string[] = ['tokens']

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

/** The answer to a pcbjs client, null for a hello without `protocol`, `major` and `capabilities`. */
export function negotiate(hello: unknown, serverVersion: string): ServerHello | null {
  const h = hello as Partial<ClientHello> | undefined
  if (!Number.isInteger(h?.protocol) || !Number.isInteger(h?.major) || !Array.isArray(h?.capabilities)) return null
  const capabilities = CLIENT_CAPABILITIES.filter(c => h.capabilities!.includes(c))
  return { protocol: Math.min(PROTOCOL, h.protocol!), major: MAJOR, capabilities, methods: Object.values(METHODS), version: serverVersion }
}
