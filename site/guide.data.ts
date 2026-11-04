import { guideData } from './scripts/guide-data.mjs'

export default {
  watch: [
    './guide/**/*.md',
    '../docs/*.md',
    '../packages/cli/templates/examples/blinky/**/*.{ts,tsx,json}',
    './scripts/guide-*.mjs',
    './scripts/preview-svg.mjs',
    './scripts/source-map.mjs',
  ],
  load: guideData,
}
