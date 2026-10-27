// only three.js, so the viewer tests import it in Node
import * as THREE from 'three'

/** The colour of the outline around a model that sits off its courtyard: the viewer's warning amber. */
export const ISSUE_COLOR = 0xe0a030

/** A thin box around a model's extent in its own frame, never picked: picking looks at meshes only. */
export function issueOutline(b: { min: [number, number, number]; max: [number, number, number] }): THREE.LineSegments {
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
  const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(edges.flatMap(i => c[i]), 3))
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: ISSUE_COLOR, transparent: true, opacity: 0.75 }))
  line.name = 'model-issue'
  line.renderOrder = 2
  return line
}
