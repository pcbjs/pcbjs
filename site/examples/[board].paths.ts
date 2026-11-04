// One full screen page per gallery board, /examples/<id>, with its viewer filling the window.
import { cards, gallery } from '../examples.data'

export default {
  watch: ['../../examples/README.md'],
  paths: async () =>
    cards(await gallery()).map(b => ({
      params: { board: b.id, title: b.name, description: b.summary || `The ${b.name} board of examples/${b.project}.` },
    })),
}
