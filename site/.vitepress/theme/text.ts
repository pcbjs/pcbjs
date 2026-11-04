// Short prose from the catalogue and examples/README.md as HTML: escaped, `code` spans kept.
export const md = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')

/** The first sentence. */
export const first = (s: string) => /^.*?\.(?=\s|$)/.exec(s)?.[0] ?? s

export const CATEGORY: Record<string, string> = {
  design: 'Design',
  routing: 'Routing',
  checks: 'Checks',
  output: 'Output',
  editor: 'Editor',
  agents: 'Agents',
  tooling: 'Tooling',
}
