// Development runtime: esbuild's jsxDev passes the source location of every element.
import { jsx, withSrc, Fragment, type JSX } from './jsx-runtime.js'
import type { Child, Component, PcbNode } from './types.js'

export { Fragment, type JSX }

export function jsxDEV(
  type: string | Component,
  props: Record<string, any>,
  _key: unknown,
  _isStatic: boolean,
  source?: { fileName: string; lineNumber: number; columnNumber: number },
): PcbNode {
  const node = jsx(type, props)
  return withSrc(node, source ? { file: source.fileName, line: source.lineNumber, col: source.columnNumber } : undefined)
}
export type { Child }
