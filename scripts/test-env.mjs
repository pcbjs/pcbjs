// Loaded by every package's test script: stage inputs are deep-frozen in tests unless PCBJS_FREEZE says otherwise, see docs/development.md.
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.PCBJS_FREEZE ??= '1'
// the user-level model cache of tests stays out of the home folder unless CI points it elsewhere
process.env.PCBJS_CACHE_DIR ??= join(tmpdir(), 'pcbjs-test-cache')
