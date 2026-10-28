import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import BoardSvg from './BoardSvg.vue'
import Gallery from './Gallery.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-image': () =>
        h(BoardSvg, { id: 'stm32-dev-stm32-dev', view: '2d', label: 'The stm32-dev example board, its copper, silkscreen and outline', class: 'hero-board' }),
    }),
  enhanceApp({ app }) {
    app.component('Gallery', Gallery)
    app.component('BoardSvg', BoardSvg)
  },
}
