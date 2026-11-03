// Code lenses in three groupings: the routes of a route element or a helper's call site, the instances of a layout's element, the findings at an element.

import type { CodeLens } from 'vscode-languageserver/node.js'
import type { RouteInfo } from '@pcbjs/core/site-data'
import { toRange } from '@pcbjs/core/internal/textdoc'
import { keyOf, partPaths, sameFile, type FileFacts, type Marker } from './facts.js'
import { findingsTitle, instancesText, routesTitle } from './format.js'

export function codeLenses(f: FileFacts): CodeLens[] {
  return [...routeLenses(f), ...instanceLenses(f), ...findingLenses(f)]
}

function lens(line: number, col: number, title: string): CodeLens {
  return { range: toRange({ line, col }), command: { title, command: '' } }
}

/** One lens per route element and per helper call site, each route once per board. */
function routeLenses(f: FileFacts): CodeLens[] {
  const groups = new Map<string, { line: number; col: number; routes: RouteInfo[]; ids: Set<string> }>()
  const put = (key: string, line: number, col: number, site: string, r: RouteInfo) => {
    const g = groups.get(key) ?? { line, col, routes: [], ids: new Set<string>() }
    groups.set(key, g)
    if (g.ids.has(`${site}|${r.id}`)) return
    g.ids.add(`${site}|${r.id}`)
    g.routes.push(r)
  }
  for (const ref of f.all) {
    const rel = keyOf(ref.root, f.file)
    if (rel === undefined) continue
    for (const r of ref.site.routes ?? []) {
      if (r.src && r.src.file === rel) put(`src ${r.src.line}:${r.src.col}`, r.src.line, r.src.col, ref.site.name, r)
      if (r.call && sameFile(ref.root, r.call.file, f.file)) put(`call ${r.call.line}:${r.call.col}`, r.call.line, r.call.col, ref.site.name, r)
    }
  }
  return [...groups.values()].map(g => lens(g.line, g.col, routesTitle(g.routes)))
}

/** One lens per element that placed the same part of a layout several times. */
function instanceLenses(f: FileFacts): CodeLens[] {
  const out: CodeLens[] = []
  const lensed = new Set<string>()
  for (const b of f.boards) {
    const paths = partPaths(b.ref.site)
    for (const r of b.ranges) {
      const k = `${r.start[0]}:${r.start[1]}`
      if (r.refs.length < 2 || lensed.has(k)) continue
      const own = r.refs.map(x => paths.get(x))
      if (own.some(x => !x) || new Set(own.map(x => x!.local)).size !== 1) continue
      lensed.add(k)
      out.push(lens(r.start[0], r.start[1], instancesText(r.refs, paths)))
    }
  }
  return out
}

function findingLenses(f: FileFacts): CodeLens[] {
  const found = new Map<string, { line: number; col: number; markers: Marker[] }>()
  for (const m of f.markers()) {
    const k = `${m.line}:${m.col}`
    const g = found.get(k) ?? { line: m.line, col: m.col, markers: [] }
    g.markers.push(m)
    found.set(k, g)
  }
  return [...found.values()].map(g => lens(g.line, g.col, findingsTitle(g.markers)))
}
