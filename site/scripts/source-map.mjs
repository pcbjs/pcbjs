// UID source ranges retain their stable identity; snapshot item IDs address the exported 2D SVG.
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { sourceIndex } from '@pcbjs/export/internal/site-data'

/** What the editor's chip would name a source range: the part, the path command or the kind of item and its net. */
function chip(r, items, text) {
  const net = items.find(it => it.net)?.net
  const zone = items.find(it => it.kind === 'zone')
  if (r.seg) return `route ${net} · ${r.seg}`
  if (r.refs.length) return r.refs.join(', ')
  const tag = /^<([A-Z]\w*)/.exec(text)?.[1]
  if (tag) return tag
  if (/^route\(/.test(text)) return `route ${net}`
  if (/^via\(/.test(text)) return `via ${net}`
  if (zone) return `pour ${net} ${zone.layer}`
  if (items.every(it => it.kind === 'track' || it.kind === 'via')) return `route ${net} · ${text}`
  if (items.every(it => it.kind === 'text')) return `text ${items[0].text}`
  if (items.every(it => it.layer === 'Edge.Cuts')) return 'outline'
  return [...new Set(items.map(it => it.kind))].join(', ')
}

/** The ranges of the entry file itself, each with its source text's chip; 1-based lines, columns end inclusive. */
export function sourceMap(board, entry, root) {
  const file = relative(root, entry)
  const lines = readFileSync(entry, 'utf8').split('\n')
  const textOf = r => (r.start[0] === r.end[0] ? lines[r.start[0] - 1].slice(r.start[1] - 1, r.end[1]) : lines[r.start[0] - 1].slice(r.start[1] - 1))
  const ranges = sourceIndex(board, p => relative(root, resolve(root, p)))[file] ?? []
  const byUid = new Map(board.items.map(item => [item.uid, item]))
  return {
    file,
    ranges: ranges.map(r => {
      const items = r.uids.map(uid => {
        const item = byUid.get(uid)
        if (!item) throw new Error(`Home source range names missing item UID: ${uid}`)
        return item
      })
      return { start: r.start, end: r.end, ids: items.map(item => item.id), uids: r.uids, refs: r.refs, chip: chip(r, items, textOf(r)) }
    }),
  }
}
