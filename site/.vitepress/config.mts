import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vitepress'
import svgLoader from '@zhangyx1998/svg-loader'
import { SCH_THEMES } from '@pcbjs/export/sch-svg'
import { dynamicPage, repo, searchSections, sidebar } from './topics'

const site = join(repo, 'site')
const brand = join(site, 'brand')
const hasBrand = (f: string) => existsSync(join(brand, f))
const github = 'https://github.com/pcbjs/pcbjs'
const host = process.env.PCBJS_SITE_URL ?? 'https://pcbjs.dev'
// '/next/' for the docs of main beside the stable tree; any base but the root is kept out of search engines
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

export default defineConfig({
  title: 'pcbjs',
  description: 'PCB design as TypeScript and JSX: a board is a module, the compiler routes, checks and writes the fab set.',
  lang: 'en-US',
  base,
  cleanUrls: true,
  lastUpdated: false,
  srcExclude: ['README.md', 'brand/**', 'scripts/**'],
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
    const url = `${root}${page.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}`
    page.frontmatter.head = [
      ...(page.frontmatter.head ?? []),
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: page.title || 'pcbjs' }],
      ...(page.description ? [['meta', { property: 'og:description', content: page.description }]] : []),
    ]
  },
  markdown: { theme: { light: 'github-light', dark: 'github-dark' } },
  vite: { plugins: [brandFiles(), svgLoader()], server: { fs: { allow: [repo] } } },
  themeConfig: {
    logo: hasBrand('logo.svg') ? { src: '/brand/logo.svg', alt: 'pcbjs' } : undefined,
    nav: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Docs', link: '/docs/quickstart', activeMatch: '^/docs/' },
      { text: 'Examples', link: '/examples' },
      { text: 'Why pcbjs', link: '/why' },
      { text: 'For agents', link: '/agents' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: { '/docs/': sidebar() },
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
