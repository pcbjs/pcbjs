// the viewer's pages: every board, the home page and the routes, with the whole of @pcbjs/ui
import { STORE, afterMount, configure, connect, createViewer, parseIdeQuery, parseViewQuery, scopeOfPath, sessionSocket, sessionUrl } from '@pcbjs/ui'
import App from './App.vue'
import { start } from './start'
import './boot.css'
import './app.css'
import '@pcbjs/ui/style.css'

void start({ STORE, afterMount, configure, connect, createViewer, parseIdeQuery, parseViewQuery, scopeOfPath, sessionSocket, sessionUrl }, App)
