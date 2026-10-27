// node fetch-model-child.js <root> <source>: downloads one model for a compile that needs it at once; exit 1 with the reason, 2 when the network is down.
import { download } from './fetch-model.js'

const [root, source] = process.argv.slice(2)
try {
  await download(root, source)
  process.exit(0)
} catch (e: any) {
  const cause = e?.cause?.code ?? e?.cause?.message
  process.stderr.write(`${String(e?.message ?? e).split('\n')[0]}${cause ? `: ${cause}` : ''}\n`)
  process.exit(e instanceof TypeError ? 2 : 1)
}
