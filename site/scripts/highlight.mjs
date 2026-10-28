// Shiki at build time for the home page: code as token spans in the site's light and dark themes, a source range as a span with data-r around its text.
import { createHighlighter } from 'shiki'

const themes = { light: 'github-light', dark: 'github-dark' }
const shiki = await createHighlighter({ themes: Object.values(themes), langs: ['tsx', 'sh'] })
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A class per colour pair, shared by every block of the page, with its CSS. */
export function palette() {
  const classes = new Map()
  const of = style => {
    const key = `${style['--shiki-light']}|${style['--shiki-dark']}|${style['--shiki-light-font-style'] ?? ''}`
    if (!classes.has(key)) classes.set(key, `t${classes.size}`)
    return classes.get(key)
  }
  const css = () =>
    [...classes]
      .map(([key, c]) => {
        const [light, dark, italic] = key.split('|')
        return `.hc .${c}{color:${light}${italic ? ';font-style:italic' : ''}}.dark .hc .${c}{color:${dark}}`
      })
      .join('')
  return { of, css }
}

/** The lines inside `#region <name>` and `#endregion <name>` with their first line number, dedented when asked. */
export function region(text, name, dedent = false) {
  const lines = text.split('\n')
  const a = lines.findIndex(l => l.includes(`#region ${name}`)),
    b = lines.findIndex(l => l.includes(`#endregion ${name}`))
  if (a < 0 || b < a) throw new Error(`no region ${name}`)
  const body = lines.slice(a + 1, b)
  const cut = dedent ? Math.min(...body.filter(l => l.trim()).map(l => /^ */.exec(l)[0].length)) : 0
  return { code: body.map(l => l.slice(cut)).join('\n'), first: a + 2 }
}

/** The code as `<span class="line">` per line; each of `ranges`, 1-based with an inclusive end column and offset by `first`, wraps its text in `<span data-r="<index>">`, nested as the ranges nest. */
export function highlight(code, lang, pal, ranges = [], first = 1) {
  const { tokens } = shiki.codeToTokens(code, { lang, themes, defaultColor: false })
  const lines = code.split('\n')
  let start = 0
  return lines
    .map((text, i) => {
      const base = start
      start += text.length + 1
      const line = first + i
      const segs = ranges
        .flatMap((r, k) =>
          line < r.start[0] || line > r.end[0]
            ? []
            : [
                {
                  k,
                  a: line === r.start[0] ? r.start[1] - 1 : /^ */.exec(text)[0].length,
                  b: line === r.end[0] ? r.end[1] : text.length,
                },
              ],
        )
        .filter(s => s.b > s.a)
        .sort((x, y) => x.a - y.a || y.b - x.b)
      const toks = tokens[i] ?? []
      const cuts = [...new Set([0, text.length, ...toks.map(t => t.offset - base), ...segs.flatMap(s => [s.a, s.b])])].filter(p => p <= text.length).sort((x, y) => x - y)
      const tokenAt = p => toks.findLast(t => t.offset - base <= p)
      let html = ''
      const stack = []
      for (let j = 0; j < cuts.length - 1; j++) {
        const p = cuts[j],
          q = cuts[j + 1]
        while (stack.length && stack.at(-1).b <= p) {
          html += '</span>'
          stack.pop()
        }
        for (const s of segs.filter(s => s.a === p)) {
          s.b = Math.min(s.b, stack.at(-1)?.b ?? Infinity)
          html += `<span data-r="${s.k}">`
          stack.push(s)
        }
        const part = text.slice(p, q),
          t = tokenAt(p)
        html += !part.trim() || !t ? esc(part) : `<span class="${pal.of(t.htmlStyle ?? {})}">${esc(part)}</span>`
      }
      html += '</span>'.repeat(stack.length)
      return `<span class="line">${html}</span>`
    })
    .join('\n')
}
