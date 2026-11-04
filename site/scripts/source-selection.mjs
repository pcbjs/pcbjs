/** Prefer the smallest visible expression; hidden source cannot be a useful hover target. */
export function excerptRange(ranges, items, refs, width) {
  const shown = ranges.flatMap((range, index) => (width(index) > 0 ? [{ range, index }] : []))
  const has = (range, item) => (typeof item === 'number' ? range.ids.includes(item) : range.uids.includes(item))
  let hits = shown.filter(({ range }) => items.some(item => has(range, item)))
  if (!hits.length) hits = shown.filter(({ range }) => refs.some(ref => range.refs.includes(ref)))
  return hits.sort((a, b) => width(a.index) - width(b.index))[0]?.index ?? -1
}
