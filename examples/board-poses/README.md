# Upright board references

Demonstrates a complete rigid pose: 3D translation plus quaternion orientation, native source dependencies, projected 2D outlines, 3D meshes and separate fabrication output. Requires the upcoming 0.1.1 changes or this source checkout.

The carrier has no parts or nets of its own, so its schematic is intentionally empty; referenced camera copper and symbols belong to the separate camera board.

The 120 × 80 mm carrier references one independent 20 × 20 × 0.8 mm camera board three times. Each camera faces carrier +Y, with its local upper edge pointing +Z. Rear-face anchors are (10, 0), (110, 0) and (60, 62) mm. Optical axes are 20 mm above the carrier's top surface; board edges span 10–30 mm above it. The lens is a mechanical envelope, not a selected optical component. The netless resistor and mounting holes demonstrate that referenced copper, BOM entries and drills remain on the camera board.

`pose.translation` uses the right-handed 3D frame: carrier X, negative carrier Y, and Z up from the carrier bottom. `orientation` is a normalized quaternion in `[x, y, z, w]` order. `[√½, 0, 0, √½]` turns the camera 90° about +X. Rotation precedes translation and pivots about the camera's bottom-face origin. The camera's bottom/rear face therefore stays on the specified anchor Y; its front face and lens project toward +Y.

```sh
npx pcbjs check --fresh=all
npx pcbjs inspect carrier.pcb.tsx --references
npx pcbjs shot carrier.pcb.tsx --view 2d --view 3d
npx pcbjs build
```

Change `cameraSize` in `dimensions.ts`: all three references update from source, without a GLB refresh step. Lower `opticalHeight` to `5` to trigger a carrier/slab collision. Collision checks use conservative vertical prisms around the transformed slab and footprint bodies; they are not a complete mechanical clearance certification.
