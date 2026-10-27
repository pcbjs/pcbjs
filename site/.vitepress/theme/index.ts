import DefaultTheme from 'vitepress/theme'
import Gallery from './Gallery.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) { app.component('Gallery', Gallery) },
}
