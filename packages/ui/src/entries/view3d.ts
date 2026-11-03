// @pcbjs/ui/view3d: the 3D view alone, as a component and as an editor pane, three.js loaded with it; see ../base.ts.
import '../style.css'
import { defineAsyncComponent } from 'vue'
import { paneOf } from '../frame'
export * from '../base'
export { default as View3D } from '../View3D.vue'
/** An editor pane showing the 3D view. */
export const Pane = paneOf({ '3d': defineAsyncComponent(() => import('../Board3D.vue')) })
