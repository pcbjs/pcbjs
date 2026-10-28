// Markdown tables stay as written: aligned padding would push the docs past their 12 kB budget.
import { parsers as builtin, printers as builtinPrinters } from 'prettier/plugins/markdown'

const { mdast } = builtinPrinters

// Prettier takes the printer from the plugin whose parser it picked, so the parser is re-exported here.
export const parsers = { markdown: builtin.markdown }

export const printers = {
  mdast: {
    ...mdast,
    print(path, options, print) {
      const { node } = path
      if (node.type !== 'table') return mdast.print(path, options, print)
      return options.originalText.slice(node.position.start.offset, node.position.end.offset)
    },
  },
}
