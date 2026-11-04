import DefaultTheme from 'vitepress/theme-without-fonts'
import { configure } from '@pcbjs/ui'
import BoardPage from './BoardPage.vue'
import Features from './Features.vue'
import Gallery from './Gallery.vue'
import DocRedirect from './DocRedirect.vue'
import { defineAsyncComponent } from 'vue'
import '@pcbjs/ui/style.css'
import './fonts.css'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // the meshes of models/<hash>.bin sit under the site's base, /stable/ for the last train
    configure({ base: import.meta.env.BASE_URL })
    app.component('Gallery', Gallery)
    app.component('DocRedirect', DocRedirect)
    app.component(
      'GuideDemo',
      defineAsyncComponent(() => import('./GuideDemo.vue')),
    )
    app.component('BoardPage', BoardPage)
    app.component('Features', Features)
  },
}
