import { developmentPaths } from '../../.vitepress/topics'

export default {
  watch: ['../../../docs/*.md', '../../scripts/development.mjs'],
  paths: () => developmentPaths('architecture'),
}
