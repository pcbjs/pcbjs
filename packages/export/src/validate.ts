import type { Board } from '@pcbjs/core/model'

/** Reject corrupt numeric geometry before an exporter calls polygon operations. */
export function validateBoard(board: Board): void {
  const coordinate = (value: number, path: string) => {
    if (!Number.isFinite(value) || Math.abs(Math.round(value * 1e6)) >= 1e10) throw new Error(`${path} exceeds Gerber FSLAX46Y46 coordinate range`)
  }
  const points = (value: unknown, path: string): void => {
    if (typeof value === 'number') coordinate(value, path)
    else if (Array.isArray(value)) value.forEach((v, i) => points(v, `${path}[${i}]`))
  }
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} must be finite`)
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`))
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`)
  }
  for (const key of ['items', 'outline', 'bbox', 'footprints', 'thickness', 'stackup'] as const) walk(board[key], `board.${key}`)
  const positive = (value: number, path: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) throw new Error(`${path} must be positive`)
  }
  const axes = (value: unknown, path: string) => {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`${path} needs two axes`)
    value.forEach((v, j) => positive(v, `${path}[${j}]`))
  }
  points(board.outline, 'board.outline')
  for (const [key, value] of Object.entries(board.bbox)) coordinate(value, `board.bbox.${key}`)
  positive(board.thickness, 'board.thickness')
  for (const [i, item] of board.items.entries()) {
    const path = `board.items[${i}]`
    for (const key of ['at', 'pts', 'poly', 'outline'] as const) if (key in item) points((item as any)[key], `${path}.${key}`)
    if (item.kind === 'pad') {
      axes(item.size, `${path}.size`)
      if (item.drill !== null) axes(item.drill, `${path}.drill`)
    } else if (item.kind === 'via') {
      positive(item.size, `${path}.size`)
      positive(item.drill, `${path}.drill`)
    }
  }
}
