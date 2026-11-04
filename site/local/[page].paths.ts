import { localDocs, localGroups } from '../scripts/local-docs.mjs'
import { repo, vueSafe } from '../.vitepress/topics'

export default {
  watch: ['../../docs/local/**/*.md', '../../docs/local/config.ts'],
  async paths() {
    const docs = await localDocs(repo, process.argv.includes('build'))
    if (!docs.length) return []
    const index =
      '# 🗂️ Local workspace\n\nPrivate working notes and revision reports, newest first. These pages are Git-ignored and available only during local development.\n\n' +
      localGroups(docs)
        .map(group => `## ${group.title}\n\n${group.items.map(doc => `- [${doc.title}](${doc.link})`).join('\n')}`)
        .join('\n\n')
    return [
      ...(docs.some(doc => doc.file === 'index.md') ? [] : [{ params: { page: 'index', title: 'Local workspace' }, content: index }]),
      ...docs.map(doc => ({ params: { page: doc.file.replace(/\.md$/, ''), title: doc.title }, content: vueSafe(doc.body) })),
    ]
  },
}
