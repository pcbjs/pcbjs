// An in-process session serving one project, shaped like the dev server the tests read: `httpServer`, `config`, `close()` and the
// `root` served. A root inside the repository's examples is copied to a temporary folder first, with its sibling folders, since the
// owner's session may already serve the checkout and a session is one per checkout.
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveSession } from '@pcbjs/cli/internal/session/serve'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const EXAMPLES = join(REPO, 'examples')

/** The example root copied under a temporary folder: the whole top-level example, so shared siblings come along. */
function copied(root) {
  const rel = relative(EXAMPLES, root)
  if (rel.startsWith('..') || !rel) return null
  const top = rel.split(sep)[0]
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), `pcbjs-${top}-`)))
  cpSync(join(EXAMPLES, top), join(tmp, top), { recursive: true, filter: p => !/\/(\.pcbjs|node_modules)(\/|$)/.test(p) })
  mkdirSync(join(tmp, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(tmp, 'node_modules', '@pcbjs'), 'dir')
  return { root: join(tmp, rel), tmp }
}

export async function dev({ root, port = 0, host = '127.0.0.1' }) {
  const copy = copied(resolve(root))
  const dir = copy?.root ?? resolve(root)
  const session = await serveSession({ projects: [{ dir }], port, host, log: () => {} })
  if (!session) throw new Error(`another session already serves ${dir}`)
  const { server } = session
  const close = async () => {
    await session.stop('test')
    if (copy) rmSync(copy.tmp, { recursive: true, force: true })
  }
  return { root: dir, httpServer: server.httpServer, config: server.config, session, close }
}
