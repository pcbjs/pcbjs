export const PERIOD: number
export const DOTS: string
export const SCREEN_SCRIPT: string
export function phase(): string
export function esc(s: string): string
export type ScreenState = 'loading' | 'idle' | 'stopped' | 'failed' | 'gone'
export interface Screen {
  mark: string
  name?: string
  text?: string
  hint?: string
  actions?: string
  state?: ScreenState
  busy?: boolean
}
export function screenInner(o: Screen): string
export function bootScreen(o: Screen): string
export function fillScreen(el: Element, o: { name?: string; text?: string; hint?: string; busy?: boolean; state?: ScreenState; progress?: number | null }): void
