import DefaultTheme from 'vitepress/theme'
import BoardSvg from './BoardSvg.vue'
import Gallery from './Gallery.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Gallery', Gallery)
    app.component('BoardSvg', BoardSvg)
  },
}
