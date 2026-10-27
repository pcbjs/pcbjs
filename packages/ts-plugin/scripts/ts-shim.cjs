// Stands in for `typescript` in the bundle: forwards to the copy tsserver hands the plugin, so no second compiler loads.
let ts
module.exports = new Proxy({}, { get: (_, k) => (k === '__bind' ? t => { ts = t } : ts?.[k]) })
