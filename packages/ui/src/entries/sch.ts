// @pcbjs/ui/sch: the schematic alone, as a component and as an editor pane, the 2D view loaded when split beside it; see ../base.ts.
import '../style.css'
import { defineAsyncComponent } from 'vue'
import BoardSch from '../BoardSch.vue'
import { paneOf } from '../frame'
export * from '../base'
export { default as SchView } from '../SchView.vue'
/** An editor pane showing the schematic. */
export const Pane = paneOf({ sch: BoardSch, '2d': defineAsyncComponent(() => import('../Board2D.vue')) })
