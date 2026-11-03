// One parsed document per file and text: its syntax tree, line table and what the capabilities read from it, each computed once on first use.

import ts from 'typescript'
import { callSpans, detect, routeCalls, type Hit, type RouteCall } from './detect.js'
import { unitMarks, withGrids, type GridOf, type Units } from './units.js'
import { textDoc, type TextDoc } from '@pcbjs/core/internal/textdoc'

export const kindOf = (file: string) => (/\.[cm]?tsx$|\.jsx$/i.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS)

let parses = 0
/** How many texts this process parsed, for the tests that count parses. */
export const parseCount = () => parses

/** A fresh syntax tree of `text`; documents go through docOf, which parses each text once. */
export function parse(text: string, file: string, parents = true): ts.SourceFile {
  parses++
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, parents, kindOf(file))
}

export interface DocModel extends TextDoc {
  readonly file: string
  sf(): ts.SourceFile
  hits(routeHelpers?: ReadonlySet<string>): Hit[]
  routeCalls(): RouteCall[]
  callSpans(): { start: number; end: number }[]
  units(gridOf?: GridOf): Units
}

const MAX = 32
const models = new Map<string, DocModel>()

/** The model of a file's text, the same one for as long as the text stays. */
export function docOf(file: string, text: string): DocModel {
  const had = models.get(file)
  if (had?.text === text) {
    models.delete(file)
    models.set(file, had)
    return had
  }
  const m = model(file, text)
  models.delete(file)
  models.set(file, m)
  if (models.size > MAX) models.delete(models.keys().next().value!)
  return m
}

const once = <T>(make: () => T): (() => T) => {
  let done = false,
    v: T
  return () => {
    if (!done) {
      v = make()
      done = true
    }
    return v
  }
}
const safe = <T>(make: () => T, none: T): (() => T) =>
  once(() => {
    try {
      return make()
    } catch {
      return none
    }
  })

function model(file: string, text: string): DocModel {
  const sf = once(() => parse(text, file))
  const hits = new Map<string, Hit[]>()
  const marks = safe(() => unitMarks(sf()), { hints: [], tokens: [], bad: [] } as Units)
  return {
    ...textDoc(text),
    file,
    sf,
    hits: helpers => {
      const key = helpers?.size ? [...helpers].sort().join() : ''
      let h = hits.get(key)
      if (!h) {
        try {
          h = detect(sf(), { routeHelpers: helpers })
        } catch {
          h = []
        }
        hits.set(key, h)
      }
      return h
    },
    routeCalls: safe(() => routeCalls(sf()), []),
    callSpans: safe(() => callSpans(sf()), []),
    units: gridOf => withGrids(marks(), gridOf),
  }
}
