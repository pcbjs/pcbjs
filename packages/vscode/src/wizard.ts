// pcbjs: New board wizard: name, layers, fab, outline and size, each prefilled so Enter takes the default, Back and Escape on every step.

import * as vscode from 'vscode'
import { defaultProjectDir, pickFolder, projectDirError, projectPrompt, scaffold, type SetupHost } from './setup'

/** The presets of @pcbjs/fab, as `FABS` in packages/fab/src/index.ts lists them. */
export const FABS = [
  'JLCPCB/2-Layer',
  'JLCPCB/4-Layer',
  'JLCPCB/4-Layer-3313',
  'JLCPCB/6-Layer',
  'JLCPCB/8-Layer',
  'PCBWay/2-Layer',
  'PCBWay/4-Layer',
  'OSHPark/2-Layer',
  'OSHPark/4-Layer',
  'Eurocircuits/2-Layer',
  'Eurocircuits/4-Layer',
  'AdvancedPCB/2-Layer',
  'AdvancedPCB/4-Layer',
]
export const LAYERS = [2, 4, 6]
export const OUTLINES = [
  { label: 'Rounded rectangle', description: '2 mm corners', flag: 'rounded:2' },
  { label: 'Rectangle', description: 'square corners', flag: 'rect' },
  { label: 'Circle', description: 'the size is its diameter', flag: 'circle' },
]
/** in mm, as `pcbjs create` takes them */
export const SIZE = '50 x 40'
export const DIAMETER = '40'
/** The template's parts need this much board, in mm, as `pcbjs create` checks. */
const MIN = { w: 20, h: 15, circle: 26 }

export interface Answers {
  name: string
  layers: number
  fab: string
  outline: string
  size: string
}

export const fabsFor = (layers: number) => FABS.filter(f => f.split('/')[1].startsWith(`${layers}-Layer`))
const isCircle = (outline: string) => outline === 'circle'

export function sizeError(value: string, circle: boolean): string | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[x×*]\s*(\d+(?:\.\d+)?))?\s*$/i.exec(value)
  if (!m) return circle ? 'Give the diameter in mm, such as 40' : 'Give the width and height in mm, such as 50 x 40'
  const w = Number(m[1])
  const h = m[2] === undefined ? w : Number(m[2])
  if (circle) return w !== h ? 'A circle takes one diameter' : w < MIN.circle ? `At least ${MIN.circle} mm for the template's parts` : undefined
  return w < MIN.w || h < MIN.h ? `At least ${MIN.w} x ${MIN.h} mm for the template's parts` : undefined
}

/** The flags of `pcbjs create` for the answers. */
export function createFlags(a: Answers): string[] {
  return ['--layers', String(a.layers), '--fab', a.fab, '--outline', a.outline, '--size', a.size.replace(/\s+/g, '').replace(/×|\*/g, 'x')]
}

const BACK = Symbol('back')
type Step = typeof BACK | 'next' | undefined
const TITLE = 'pcbjs: New board wizard'
const TOTAL = 5

function pick<T extends vscode.QuickPickItem>(step: number, placeholder: string, items: T[], active: T | undefined): Promise<T | typeof BACK | undefined> {
  const qp = vscode.window.createQuickPick<T>()
  Object.assign(qp, { title: TITLE, step, totalSteps: TOTAL, placeholder, items, ignoreFocusOut: true, buttons: step > 1 ? [vscode.QuickInputButtons.Back] : [] })
  if (active) qp.activeItems = [active]
  return new Promise(done => {
    qp.onDidTriggerButton(b => b === vscode.QuickInputButtons.Back && (done(BACK), qp.hide()))
    qp.onDidAccept(() => {
      done(qp.selectedItems[0] ?? qp.activeItems[0])
      qp.hide()
    })
    qp.onDidHide(() => {
      done(undefined)
      qp.dispose()
    })
    qp.show()
  })
}

function type(step: number, prompt: string, value: string, validate: (v: string) => string | undefined): Promise<string | typeof BACK | undefined> {
  const box = vscode.window.createInputBox()
  Object.assign(box, { title: TITLE, step, totalSteps: TOTAL, prompt, value, ignoreFocusOut: true, buttons: step > 1 ? [vscode.QuickInputButtons.Back] : [] })
  box.validationMessage = validate(value)
  return new Promise(done => {
    box.onDidChangeValue(v => (box.validationMessage = validate(v)))
    box.onDidTriggerButton(b => b === vscode.QuickInputButtons.Back && (done(BACK), box.hide()))
    box.onDidAccept(() => {
      const err = validate(box.value)
      box.validationMessage = err
      if (err) return
      done(box.value.trim())
      box.hide()
    })
    box.onDidHide(() => {
      done(undefined)
      box.dispose()
    })
    box.show()
  })
}

const answered = <T>(r: T | typeof BACK | undefined, keep: (v: T) => void): Step => {
  if (r === undefined) return undefined
  if (r === BACK) return BACK
  keep(r)
  return 'next'
}

function steps(parent: string): ((a: Answers) => Promise<Step>)[] {
  return [
    async a => answered(await type(1, projectPrompt(parent), a.name, v => projectDirError(parent, v)), v => (a.name = v)),
    async a => {
      const items = LAYERS.map(n => ({ label: `${n} layers`, n }))
      return answered(
        await pick(
          2,
          'How many copper layers?',
          items,
          items.find(i => i.n === a.layers),
        ),
        i => {
          if (i.n !== a.layers) a.fab = `JLCPCB/${i.n}-Layer`
          a.layers = i.n
        },
      )
    },
    async a => {
      const items = fabsFor(a.layers).map(fab => ({ label: fab, description: `@pcbjs/fab/${fab}` }))
      return answered(
        await pick(
          3,
          'Which fab preset: stackup, rules and sourcing?',
          items,
          items.find(i => i.label === a.fab),
        ),
        i => (a.fab = i.label),
      )
    },
    async a => {
      const items = OUTLINES.map(o => ({ ...o }))
      return answered(
        await pick(
          4,
          'Which board outline?',
          items,
          items.find(i => i.flag === a.outline),
        ),
        i => {
          if (isCircle(i.flag) !== isCircle(a.outline)) a.size = isCircle(i.flag) ? DIAMETER : SIZE
          a.outline = i.flag
        },
      )
    },
    async a => {
      const circle = isCircle(a.outline)
      const prompt = circle ? 'The diameter in mm' : 'The width x height in mm'
      return answered(await type(5, prompt, a.size, v => sizeError(v, circle)), v => (a.size = v))
    },
  ]
}

/** Every step's answer, or undefined on Escape. */
export async function askBoard(parent: string): Promise<Answers | undefined> {
  const a: Answers = { name: defaultProjectDir(parent), layers: 2, fab: 'JLCPCB/2-Layer', outline: OUTLINES[0].flag, size: SIZE }
  const all = steps(parent)
  for (let i = 0; i < all.length;) {
    const r = await all[i](a)
    if (r === undefined) return undefined
    i = r === BACK ? Math.max(0, i - 1) : i + 1
  }
  return a
}

export async function newBoardWizard(h: SetupHost): Promise<string | undefined> {
  const parent = await pickFolder('Create the board in which folder?', 'Create here')
  if (!parent) return undefined
  const a = await askBoard(parent)
  if (!a) return undefined
  return scaffold(h, parent, a.name, createFlags(a))
}
