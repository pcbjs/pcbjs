// @pcbjs/ui/view2d: the 2D view alone, as a component and as an editor pane; see ../base.ts.
import '../style.css'
import Board2D from '../Board2D.vue'
import { paneOf } from '../frame'
export * from '../base'
export { default as View2D } from '../View2D.vue'
/** An editor pane showing the 2D view. */
export const Pane = paneOf({ '2d': Board2D })
