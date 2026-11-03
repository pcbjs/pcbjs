// an editor's pane, `?ide=1&view=2d|3d|sch|checks`: the one view it shows, loaded with its entry of @pcbjs/ui and nothing of the other views
import PaneApp from './PaneApp.vue'
import { start } from './start'
import './boot.css'
import './app.css'
import '@pcbjs/ui/style.css'

const ENTRIES = {
  '2d': () => import('@pcbjs/ui/view2d'),
  '3d': () => import('@pcbjs/ui/view3d'),
  sch: () => import('@pcbjs/ui/sch'),
  checks: () => import('@pcbjs/ui/checks'),
}
const view = new URLSearchParams(location.search).get('view')?.toLowerCase()
const ui = await (view === '2d' || view === 'sch' || view === 'checks' ? ENTRIES[view] : ENTRIES['3d'])()
void start(ui, PaneApp, { pane: ui.Pane })
