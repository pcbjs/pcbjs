---
title: Model mesh binary
description: The byte layout, units and version of the cached and served PCBM mesh format.
---

# Model mesh binary

pcbjs caches and serves converted model geometry in the `PCBM` format. This is distinct from a STEP source file, a GLB export and the JSON model descriptor. The encoder and decoder in [step/binary.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/step/src/binary.ts) own its byte-level contract.

## Encoding rules

All multibyte values are little-endian. The header and every block start on a four-byte boundary. Mesh positions use millimetres in the source model's frame; placement transforms belong to the consuming model descriptor. RGB values are linear, not sRGB bytes.

## File header

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | 4 bytes | ASCII `PCBM` |
| 4 | `uint16` | Version `1` |
| 6 | `uint16` | Reserved, written as zero |
| 8 | `uint32` | Mesh count |

The first mesh begins at byte 12. Meshes follow consecutively in the declared order.

## Per-mesh header

| Relative offset | Type | Meaning |
| --- | --- | --- |
| 0, 4, 8 | Three `float32` values | Linear red, green and blue |
| 12 | `uint32` | Vertex count `N` |
| 16 | `uint32` | Index count `I` |
| 20 | `uint32` | Index element size `S`, either 2 or 4 bytes |

The payload immediately follows this 24-byte header:

1. Positions: `3 × N` float32 values, x/y/z per vertex, occupying `12 × N` bytes.
2. Normals: `3 × N` signed int8 values, one x/y/z triple per vertex, padded to a four-byte boundary.
3. Indices: `I` unsigned integers of size `S`, padded to a four-byte boundary. Three indices form a triangle.

The encoder rounds normal components multiplied by 127 and clamps to `[-127, 127]`. The decoder reconstructs and normalizes each triple. This is a quantized representation; normals are not preserved as original float32 values.

The encoder chooses two-byte indices for at most 65,535 vertices, otherwise four-byte indices. The next mesh starts after the final padding. Padding is not geometry and must not be interpreted as extra indices.

## Reader behavior and limitations

The current decoder rejects a missing/short header, wrong magic, unsupported version and truncated blocks. It returns float32 position/normal arrays and uint32 indices. A zero normal triple remains zero after normalization's zero-length guard.

Version acceptance and buffer bounds checks do not establish that every numeric or topology constraint is validated for arbitrary hostile files. The format requires the declared index sizes and meaningful triangle indices; do not infer a complete schema-validation guarantee from the existing decoder. This format is an implementation artifact served with the matching pcbjs build, not a promise of lossless source-model round trips.

Model conversion options, hashes, cache ownership and placement are specified in [3D descriptors and model artifacts](./3d). A change to this binary contract requires coordinated readers/writers and an appropriate format/cache compatibility review.
