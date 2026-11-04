import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vitepress'
import type { ShikiTransformer } from 'shiki'
import svgLoader from '@zhangyx1998/svg-loader'
import { SCH_THEMES } from '@pcbjs/export/internal/sch-svg'
import { pcbjs } from '@pcbjs/cli/vite'
import { siteBoards } from '../boards'
import { measure, report } from '../scripts/measure.mjs'
import { localDocs, localDocsWatch, localSidebar } from '../scripts/local-docs.mjs'
import { dynamicPage, repo, searchSections, sidebar } from './topics'
import { guideSidebar } from './guide'
import { developmentSidebar, developmentTopics, developmentLinkRenderer, developmentRedirects } from '../scripts/development.mjs'
import { guideExamples, guideFences } from '../scripts/guide-examples.mjs'

const site = join(repo, 'site')
const brand = join(site, 'brand')
const hasBrand = (f: string) => existsSync(join(brand, f))
const github = 'https://github.com/pcbjs/pcbjs'
const host = process.env.PCBJS_SITE_URL ?? 'https://pcbjs.dev'
// '/stable/' for the docs of the last train beside main at the root; any base but the root is kept out of search engines
const base = process.env.PCBJS_SITE_BASE ?? '/'
const root = `${host}${base}`
// the schematic SVGs colour themselves from --sch-*: the exporter's light and dark themes, switched with VitePress's .dark
const schVars = (theme: keyof typeof SCH_THEMES) =>
  Object.entries(SCH_THEMES[theme])
    .map(([k, v]) => `--sch-${k}:${v}`)
    .join(';')
const schThemes = `:root{${schVars('light')}}.dark{${schVars('dark')}}`

/** Serves and emits site/brand/* at /brand/, so the logo worker's files need no copy in public/. */
function brandFiles(): Plugin {
  return {
    name: 'pcbjs-brand',
    configureServer(server) {
      server.middlewares.use('/brand/', (req, res, next) => {
        const file = join(brand, decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!file.startsWith(brand) || !existsSync(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      if (!existsSync(brand)) return
      for (const f of readdirSync(brand)) if (/\.(svg|png|ico|webp)$/.test(f)) this.emitFile({ type: 'asset', fileName: `brand/${f}`, source: readFileSync(join(brand, f)) })
    },
  }
}

const GUIDE_BOARDS = 'virtual:guide-boards'
function guideBoards(): Plugin {
  return {
    name: 'pcbjs-guide-boards',
    resolveId: id => (id === GUIDE_BOARDS ? '\0' + id : null),
    load(id) {
      if (id !== '\0' + GUIDE_BOARDS) return null
      const examples = guideExamples()
      return (
        examples.map((e, i) => `import b${i} from ${JSON.stringify(e.file + '?pcb:board')}`).join('\n') +
        `\nexport default {${examples.map((e, i) => `${JSON.stringify(e.id)}: b${i}`).join(',')}}`
      )
    },
  }
}

const BOARDS = 'virtual:site-boards'

/** `virtual:site-boards`: the `?pcb:board` ref of every board siteBoards() compiled, by page id; compiled in the reader's browser, `boards: 'compile'`. */
function boardRefs(): Plugin {
  return {
    name: 'pcbjs-site-boards',
    resolveId: id => (id === BOARDS ? `\0${BOARDS}` : null),
    async load(id) {
      if (id !== `\0${BOARDS}`) return null
      const boards = await siteBoards()
      const imports = boards.map((b, i) => `import b${i} from ${JSON.stringify(`${b.file}?pcb:board`)}`)
      return `${imports.join('\n')}\nexport default { ${boards.map((b, i) => `${JSON.stringify(b.id)}: b${i}`).join(', ')} }\n`
    },
  }
}

export default async ({ command }: { command: 'build' | 'serve' }) => {
  // a build writes each code token's colours as a class, the pairs once per page head: a quarter of the docs' bytes were these styles
  const building = command === 'build'
  const privateDocs = await localDocs(repo, building)
  const tokenPairs = new Map<string, string>()
  const tokenClasses: ShikiTransformer = {
    name: 'pcbjs-token-classes',
    span(node) {
      const style = node.properties.style
      if (typeof style !== 'string' || !style.startsWith('--shiki-')) return
      let c = tokenPairs.get(style)
      if (!c) tokenPairs.set(style, (c = `t${tokenPairs.size}`))
      delete node.properties.style
      node.properties.class = c
    },
  }
  const tokenStyles = new Map<string, string>()

  return defineConfig({
    title: 'pcbjs',
    description: 'PCB design as TypeScript and JSX: a board is a module, the compiler routes, checks and writes the fab set.',
    lang: 'en-US',
    base,
    cleanUrls: true,
    // the hash map and site data in one shared chunk, not inlined in every page
    metaChunk: true,
    lastUpdated: false,
    srcExclude: ['README.md', 'brand/**', 'scripts/**', 'features/**', ...(building ? ['local/**'] : [])],
    sitemap: { hostname: root },
    head: [
      ...(hasBrand('favicon.svg') ? [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}brand/favicon.svg` }] as [string, Record<string, string>]] : []),
      ...(base === '/' ? [] : [['meta', { name: 'robots', content: 'noindex' }] as [string, Record<string, string>]]),
      ['meta', { name: 'theme-color', content: '#1f7a4d' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'pcbjs' }],
      ['meta', { property: 'og:image', content: `${root}brand/og.png` }],
      ['meta', { property: 'og:image:width', content: '1200' }],
      ['meta', { property: 'og:image:height', content: '630' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['style', {}, schThemes],
    ],
    transformPageData(page) {
      const p = page.params
      if (p?.title) page.title = p.title
      if (p?.description) page.description = p.description
      if (page.relativePath.startsWith('local/')) {
        page.frontmatter.editLink = false
        page.frontmatter.search = false
        page.frontmatter.head = [['meta', { name: 'robots', content: 'noindex,nofollow' }]]
        return
      }
      const moved = page.relativePath.startsWith('docs/') ? developmentTopics.get(p?.topic) : undefined
      if (moved) page.frontmatter.search = false
      const canonical = moved?.link.slice(1) ?? page.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
      const url = `${root}${canonical}`
      page.frontmatter.head = [
        ...(page.frontmatter.head ?? []),
        ['link', { rel: 'canonical', href: url }],
        ['meta', { property: 'og:url', content: url }],
        ['meta', { property: 'og:title', content: page.title || 'pcbjs' }],
        ...(page.description ? [['meta', { property: 'og:description', content: page.description }]] : []),
      ]
    },
    markdown: {
      config: md => {
        guideFences(md)
        developmentLinkRenderer(md)
      },
      theme: { light: 'github-light', dark: 'github-dark' },
      codeTransformers: building ? [tokenClasses] : [],
    },
    transformHtml(html) {
      if (!tokenPairs.size) return html
      const css = [...tokenPairs].map(([style, c]) => `.${c}{${style}}`).join('')
      const file = `assets/code-tokens.${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css`
      tokenStyles.set(file, css)
      return html.replace('</head>', `<link rel="stylesheet" href="${base}${file}"></head>`)
    },
    buildEnd(cfg) {
      for (const [file, css] of tokenStyles) writeFileSync(join(cfg.outDir, file), css)
      console.log(report(measure(cfg.outDir)).join('\n'))
      console.log(`site: built in ${process.uptime().toFixed(1)} s, the boards compiled in Node included`)
    },
    vite: {
      plugins: [developmentRedirects(base, host), localDocsWatch(repo), brandFiles(), boardRefs(), guideBoards(), pcbjs({ boards: 'compile' }), svgLoader()],
      server: { host: '0.0.0.0', port: 8080, strictPort: true, allowedHosts: ['dev.z-yx.net'], fs: { allow: [repo] } },
    },
    themeConfig: {
      logo: hasBrand('logo.svg') ? { src: '/brand/logo.svg', alt: 'pcbjs' } : undefined,
      nav: [
        { text: 'Guide', link: '/guide/getting-started/', activeMatch: '^/(guide/|getting-started)' },
        { text: 'Reference', link: '/docs/basics', activeMatch: '^/docs/' },
        { text: 'Examples', link: '/examples' },
        {
          text: 'Resources',
          items: [
            { text: 'Development', link: '/development/', activeMatch: '^/development/' },
            { text: 'Features', link: '/features' },
            { text: 'Why pcbjs', link: '/why' },
            { text: 'For agents', link: '/agents' },
            { text: 'Changelog', link: '/changelog' },
          ],
        },
        ...(privateDocs.length ? [{ text: '🗂️ Local', link: '/local/', activeMatch: '^/local/' }] : []),
      ],
      sidebar: {
        '/development/': developmentSidebar,
        '/guide/': guideSidebar,
        '/getting-started': guideSidebar,
        '/docs/': sidebar(),
        ...(privateDocs.length ? { '/local/': localSidebar(privateDocs) } : {}),
      },
      search: {
        provider: 'local',
        options: {
          miniSearch: {
            _splitIntoSections: (file: string) => {
              const md = dynamicPage(relative(site, file).replace(/\\/g, '/'))
              return md === undefined ? undefined : searchSections(md)
            },
          },
        },
      },
      socialLinks: [{ icon: 'github', link: github }],
      editLink: {
        pattern: ({ filePath, params }) =>
          `https://github.com/pcbjs/pcbjs/edit/main/${params?.topic ? `docs/${params.topic}.md` : params?.page === 'agents' ? 'README.md' : params?.page === 'changelog' ? 'CHANGELOG.md' : `site/${filePath}`}`,
        text: 'Edit this page on GitHub',
      },
      outline: { level: [2, 3] },
      footer: { message: 'MIT licensed. A proof of concept, pre 0.1.', copyright: 'pcbjs contributors' },
    },
  })
}
