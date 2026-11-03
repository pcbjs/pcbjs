// the parts of untyped dependencies the scene geometry uses
declare module 'clipper-lib'

declare module 'three' {
  export class Vector2 {
    constructor(x: number, y: number)
    x: number
    y: number
  }
  export const ShapeUtils: { triangulateShape(contour: Vector2[], holes: Vector2[][]): number[][] }
}
