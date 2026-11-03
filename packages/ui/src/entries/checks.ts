// @pcbjs/ui/checks: the DRC and ERC details viewer, sharing the board's canonical finding focus.
import '../style.css'
import ChecksView from '../ChecksView.vue'
import { paneOf } from '../frame'
export * from '../base'
export { default as ChecksView } from '../ChecksView.vue'
/** An editor pane showing the DRC and ERC details. */
export const Pane = paneOf({ checks: ChecksView })
