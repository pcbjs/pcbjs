// Loaded with `node --import`: records every module that resolves into @pcbjs/lsp in the file named by PCBJS_TRACE, through
// the module loader's own resolve hook, so a test can prove a command never loaded the language server.
import { registerHooks } from 'node:module'
import { appendFileSync } from 'node:fs'

const out = process.env.PCBJS_TRACE
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context)
    if (out && (specifier === '@pcbjs/lsp' || specifier.startsWith('@pcbjs/lsp/') || /\/packages\/lsp\/|\/@pcbjs\/lsp\//.test(r.url))) appendFileSync(out, `${specifier} ${r.url}\n`)
    return r
  },
})
