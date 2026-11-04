import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Discover Markdown only. Never follow symlinks out of the private documentation folder. */
export function localFiles(repo) {
  const root = join(repo, 'docs/local')
  const files = []
  function visit(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile() && entry.name.endsWith('.md') && readFileSync(file, 'utf8').trim()) files.push(relative(root, file).replaceAll('\\', '/'))
    }
  }
  visit(root)
  return files.sort()
}

export async function localDocs(repo, building = false) {
  // Do not even execute a contributor's local config during production builds.
  if (building) return []
  const files = localFiles(repo)
  if (!files.length) return []
  const configFile = join(repo, 'docs/local/config.ts')
  let config = {}
  if (existsSync(configFile)) {
    const { loadConfigFromFile } = await import('vite')
    config = (await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile, repo))?.config ?? {}
  }
  const items = config.items ?? []
  for (const item of items)
    if (typeof item.file !== 'string' || item.file.startsWith('/') || item.file.split(/[\\/]/).includes('..') || !item.file.endsWith('.md'))
      throw new Error(`local/config.ts: expected a relative Markdown filename: ${item.file}`)
  const configured = file => {
    const index = items.findIndex(item => item.file === file)
    return index < 0 ? Infinity : index
  }
  return files
    .map(file => {
      const body = readFileSync(join(repo, 'docs/local', file), 'utf8')
      const override = items.find(item => item.file === file)
      const title = override?.text ?? body.match(/^# (.+)$/m)?.[1] ?? file.replace(/\.md$/, '')
      const date = override?.date ?? file.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`local/config.ts: use YYYY-MM-DD for ${file}`)
      return { file, title, date, link: `/local/${file.replace(/\.md$/, '')}`, body }
    })
    .sort((a, b) => b.date.localeCompare(a.date) || configured(a.file) - configured(b.file) || b.file.localeCompare(a.file))
}

/** Date sections shared by the local index and sidebar, newest first. */
export function localGroups(docs) {
  const groups = new Map()
  for (const doc of docs) {
    if (!groups.has(doc.date)) groups.set(doc.date, [])
    groups.get(doc.date).push(doc)
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, items]) => ({ date, title: date || 'Undated', items }))
}

export function localSidebar(docs) {
  return [
    { text: '🗂️ Local workspace', items: [{ text: 'All local documents', link: '/local/' }] },
    ...localGroups(docs).map(group => ({ text: group.title, collapsed: false, items: group.items.map(doc => ({ text: doc.title, link: doc.link })) })),
  ]
}

/** Restart on inventory/config changes so the nav and native route table stay in sync. */
export function localDocsWatch(repo) {
  const root = join(repo, 'docs/local')
  return {
    name: 'pcbjs-local-docs',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add([join(repo, 'docs'), root])
      let timer
      const change = (event, path) => {
        const name = relative(root, path).replaceAll('\\', '/')
        if (name.startsWith('../') || name === '..') return
        if (!name.endsWith('.md') && name !== 'config.ts') return
        if (!['add', 'unlink', 'change'].includes(event)) return
        clearTimeout(timer)
        // VitePress must recreate its site config and route/search state as well as Vite.
        timer = setTimeout(() => server.watcher.emit('change', join(repo, 'site/.vitepress/config.mts')), 100)
      }
      server.watcher.on('all', change)
      server.httpServer?.once('close', () => {
        clearTimeout(timer)
        server.watcher.off('all', change)
      })
      server.middlewares.use((req, res, next) => {
        if (/(?:^|\/)local(?:\/|$)/.test((req.url ?? '').split('?')[0])) {
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('X-Robots-Tag', 'noindex, nofollow')
        }
        next()
      })
    },
  }
}
