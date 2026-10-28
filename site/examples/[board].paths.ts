// One full screen page per gallery board, /examples/<id>, with its viewer filling the window.
import gallery from '../examples.data'

export default {
  watch: ['../.gallery/boards.json', '../../examples/README.md'],
  paths: () =>
    gallery.load().flatMap(p =>
      p.boards.map(b => ({
        params: { board: b.id, title: b.name, description: b.summary || `The ${b.name} board of examples/${b.project}.` },
      })),
    ),
}
