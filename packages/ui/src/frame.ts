// An editor pane's board page: the views it shows and nothing else, the rails loaded when a drawer opens, so a per-view entry of
// @pcbjs/ui carries its own view alone.
import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'
import type { Mode } from './pane'
import BoardFrame from './BoardFrame.vue'

const rails = {
  left: defineAsyncComponent(() => import('./RailLeft.vue')),
  right: defineAsyncComponent(() => import('./RailRight.vue')),
}

/** The board page of a pane showing `views`, with BoardPage's `status` prop and its `empty` and `overlay` slots. */
export const paneOf = (views: Partial<Record<Mode, Component>>): Component =>
  defineComponent({
    name: 'Pane',
    props: { status: String },
    setup:
      (props, { slots }) =>
      () =>
        h(BoardFrame, { views, rails, status: props.status }, slots),
  })
