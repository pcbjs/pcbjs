// One owner per contract topic; the Markdown stays in docs/ for the CLI and website alike.
export const development = [
  {
    id: 'architecture',
    title: 'Architecture',
    summary: 'Package boundaries, compilation, runtime ownership and browser execution.',
    groups: [
      {
        title: 'System and execution',
        topics: [
          ['design', 'Compiler and canonical model'],
          ['development', 'Packages and dependency boundaries'],
          ['workspace', 'Projects and worktrees'],
          ['browser', 'Browser execution and parity'],
        ],
      },
    ],
  },
  {
    id: 'syntax',
    title: 'Syntax and semantics',
    pages: [['project', 'Projects and modules']],
    summary: 'Project structure, declarations, coordinates, composition and routing expressions.',
    groups: [
      {
        title: 'Structure and identity',
        topics: [
          ['board', 'Board roots, units and layers'],
          ['refs', 'Reference grammar and identity'],
        ],
      },
      {
        title: 'Electrical declarations',
        topics: [
          ['schematic', 'Parts, pins and nets'],
          ['circuits', 'Circuits, layouts and overrides'],
          ['schematic-graphic', 'Schematic drawing syntax'],
          ['sourcing', 'Sourcing and population'],
        ],
      },
      {
        title: 'Geometry and placement',
        topics: [
          ['layout', 'Elements, pads and graphics'],
          ['footprints', 'Footprint definitions'],
          ['grids', 'Coordinate grids and subdivisions'],
          ['placement', 'Placement constraints and followers'],
          ['fonts', 'Text and fonts'],
          ['references', 'Mechanical board references'],
        ],
      },
      {
        title: 'Copper and constraints',
        topics: [
          ['routing', 'Route-chain syntax'],
          ['route-options', 'Routing options and precedence'],
          ['pours', 'Pours, thermal reliefs and stitching'],
          ['pairs', 'Differential pairs'],
          ['length', 'Length targets and matching'],
          ['patches', 'Copper patches'],
          ['rules', 'Design-rule values'],
          ['stackup', 'Stackups and defaults'],
          ['fab', 'Fabrication presets and variants'],
        ],
      },
    ],
  },
  {
    id: 'interfaces',
    title: 'Interfaces',
    summary: 'Compiler hooks, UI integration, queries and rendering APIs.',
    groups: [
      {
        title: 'Integration contracts',
        topics: [
          ['plugins', 'Compiler and plugin APIs'],
          ['ui', 'UI components and board imports'],
          ['queries', 'Query and event APIs'],
          ['render', 'Rendering API'],
        ],
      },
    ],
  },
  {
    id: 'formats',
    title: 'Exchange formats',
    pages: [
      ['viewer-data', 'Viewer records and snapshots'],
      ['mesh-binary', 'Model mesh binary'],
    ],
    summary: 'Board and viewer data, findings, fabrication artifacts, models and library packages.',
    groups: [
      {
        title: 'Artifacts and records',
        topics: [
          ['findings', 'Diagnostic records and rule catalog'],
          ['fab-set', 'Fabrication files and PCB SVG'],
          ['3d', '3D descriptors and model artifacts'],
          ['library', 'Published library packages'],
        ],
      },
    ],
  },
  {
    id: 'communication',
    title: 'Communication protocols',
    summary: 'Sessions, transport framing, compatibility, language clients and agents.',
    groups: [
      {
        title: 'Connections and messages',
        topics: [
          ['session', 'Session lifecycle and ownership'],
          ['ide-bridge', 'Wire protocol and compatibility'],
          ['lsp', 'Language-server integration'],
          ['mcp', 'Agent tools and messaging'],
        ],
      },
    ],
  },
  {
    id: 'interaction',
    title: 'User interaction protocols',
    summary: 'Selection, focus, edits, cancellation, cameras and VS Code host behavior.',
    groups: [
      {
        title: 'Shared behavior',
        topics: [
          ['interaction', 'Operation contract and state transitions'],
          ['viewer', 'View state, selection and embedding'],
          ['highlight', 'Source-to-entity focus'],
          ['keys', 'Keyboard and pointer bindings'],
        ],
      },
      {
        title: 'Editing and editor hosts',
        topics: [
          ['editing', 'Edit transactions and gestures'],
          ['layout-editing', 'Instance and library editing'],
          ['editor-actions', 'VS Code action contract'],
          ['vscode', 'Extension lifecycle and commands'],
        ],
      },
    ],
  },
]

export const developmentTopics = new Map(
  development.flatMap(section =>
    section.groups.flatMap(group => group.topics.map(([topic, title]) => [topic, { topic, title, section: section.id, link: `/development/${section.id}/${topic}` }])),
  ),
)
export const developmentSidebar = [
  {
    text: 'Development',
    items: [
      { text: 'Overview and authority', link: '/development/' },
      { text: 'Conformance and compatibility', link: '/development/conformance' },
    ],
  },
  ...development.map(section => ({
    text: section.title,
    collapsed: true,
    items: [
      { text: 'Scope and invariants', link: `/development/${section.id}/` },
      ...(section.pages ?? []).map(([path, text]) => ({ text, link: `/development/${section.id}/${path}` })),
      ...section.groups.map(group => ({
        text: group.title,
        collapsed: false,
        items: group.topics.map(([topic]) => ({ text: developmentTopics.get(topic).title, link: developmentTopics.get(topic).link })),
      })),
    ],
  })),
]

export const topicLink = topic => developmentTopics.get(topic)?.link ?? (topic === 'quickstart' ? '/guide/getting-started/quickstart' : `/docs/${topic}`)

/** Rewrite documentation links, leaving source examples and external links untouched. */
export function developmentLinks(markdown, topics) {
  return markdown
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/(\]\()((?:\.\/|\/docs\/)?([\w-]+)(?:\.md)?)(#[^\s)]*)?(\))/g, (all, before, path, topic, hash = '', after) =>
            topics.has(topic) ? `${before}${topicLink(topic)}${hash}${after}` : all,
          ),
    )
    .join('')
}

/** Static guide pages also link directly to canonical contracts, before VitePress adds the deployment base. */
export function developmentLinkRenderer(md) {
  const render = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const match = /^\/docs\/([\w-]+)(?:\.md)?([?#].*)?$/.exec(token.attrGet('href') ?? '')
    if (match && (developmentTopics.has(match[1]) || match[1] === 'quickstart')) token.attrSet('href', topicLink(match[1]) + (match[2] ?? ''))
    return render ? render(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
  }
}

/** The short-lived Specifications URLs remain usable without duplicating page bundles or search entries. */
export const legacyDevelopmentRoutes = new Map([
  ['/specifications/', '/development/'],
  ['/specifications/conformance', '/development/conformance'],
  ...development.flatMap(section => [
    [`/specifications/${section.id}/`, `/development/${section.id}/`],
    ...(section.pages ?? []).map(([page]) => [`/specifications/${section.id}/${page}`, `/development/${section.id}/${page}`]),
  ]),
  ...[...developmentTopics.values()].map(topic => [topic.link.replace('/development/', '/specifications/'), topic.link]),
])

export function developmentRedirects(base, host) {
  const target = path => base + path.slice(1)
  return {
    name: 'pcbjs-development-redirects',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (base !== '/' && !url.pathname.startsWith(base)) return next()
        const path = base === '/' ? url.pathname : '/' + url.pathname.slice(base.length)
        const normalized = path.replace(/index\.html$/, '').replace(/\.html$/, '')
        const to = legacyDevelopmentRoutes.get(normalized) ?? legacyDevelopmentRoutes.get(normalized + '/')
        if (!to) return next()
        res.writeHead(302, { Location: target(to) + url.search, 'Cache-Control': 'no-store' }).end()
      })
    },
    generateBundle() {
      for (const [from, to] of legacyDevelopmentRoutes) {
        const url = target(to)
        const source = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Development · pcbjs</title><link rel="canonical" href="${host}${url}"><script>location.replace(${JSON.stringify(url)}+location.search+location.hash)</script></head><body><p>This page moved to <a href="${url}">Development</a>.</p></body></html>`
        this.emitFile({ type: 'asset', fileName: from.slice(1) + (from.endsWith('/') ? 'index.html' : '.html'), source })
      }
    },
  }
}
