---
title: Exchange formats
description: Record shapes, identifiers, coordinates, artifact encoding and format compatibility.
---

# Exchange formats

This section defines data representations independently of the transport carrying them. A viewer facet sent over WebSocket and the equivalent static facet use the same data contract; framing and sequencing belong to [Communication](../communication/).

## Format inventory

| Representation | Purpose | Authoritative definition / detail |
| --- | --- | --- |
| `Board` | Canonical compiled geometry, connectivity, provenance and findings | [core/model.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/model.ts), [compiler architecture](../architecture/design) |
| `SiteData` and facets | Viewer-oriented records split by consumer demand | [core/site-data.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/site-data.ts), [core/site-facets.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/site-facets.ts) |
| Packed shapes | Item-indexed polygon rings, coverage and openings | [core/site-shapes.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/site-shapes.ts) |
| `Selection` | Shared board/target/snapshot focus state | [core/selection.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/selection.ts), [interaction state](../interaction/) |
| Diagnostic records | Rule, severity, entity references, location and optional evidence | [Findings](./findings), [core/finding.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/finding.ts) |
| `BrowserModule` | Packaged virtual project for browser compilation | [Browser module format](../architecture/browser#the-module), currently format `1` |
| Manufacturing set | Gerbers, drills, BOM, placement, manifest, zip and SVG | [Fabrication files](./fab-set) |
| Model descriptors and meshes | Generated/file model placement and converted geometry | [3D descriptors](./3d), [step/binary.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/step/src/binary.ts) |
| Library package | Exported parts/circuits and built boards consumed by another project | [Library packaging](./library) |

The dedicated [Viewer records and snapshots](./viewer-data) page defines headers, packed shapes, source locations and envelopes. [Model mesh binary](./mesh-binary) specifies the byte layout of converted geometry.

## Identity and coordinates

A numeric item ID is local to a compile. Cross-compile relationships use the declared references, UIDs and snapshot context. Reusing an old numeric ID after a new snapshot can select an unrelated item. A UID derives from source identity; edits can change it, so a UID is not a promise of permanence through arbitrary source rewrites.

Compiled board geometry uses millimetres and y-down coordinates. Source positions may use grids or explicit units; conversion happens before they become board coordinates. Model-local positions and placement transforms must be interpreted in their documented frames. LSP positions use zero-based lines and UTF-16 characters, while compiler source ranges use their own declared representation; do not copy coordinates between these formats without conversion.

Runs, snapshots and event cursors are different identifiers: snapshots use `<session>.<run>` and event cursors use `<session>:<seq>`. They cannot be sorted or substituted as if they were the same field.

## Viewer facets

| Facet | Principal contents |
| --- | --- |
| `meta` | Board identity, rules, stackup, bounds, nets, footprints and edit availability |
| `sch` | Schematic drawing |
| `layers` | Layers, holes, source ranges, item rows and routing records |
| `shapes` | Geometry rings, face coverage and openings |
| `model` | 3D model representation |
| `findings` | DRC/ERC, ratsnest, connectivity and statistics |
| `fab` | BOM, fabrication/download metadata and timings |

The `FACETS` table is the authoritative key-to-facet and facet-to-view mapping. Consumers must not assume that loading one facet supplies another. Streaming identity, invalidation and hashes are specified in [Viewer loading](../interaction/viewer#loading-states-and-the-live-board).

Packed rings use parallel arrays: `ids` names each item's numeric ID, `n` gives that item's ring count, `len` gives each ring's point count, and `xy` concatenates x/y pairs. Interpret these arrays together and use the shared pack/read helpers. Shape IDs are not indexes into the array of item rows.

## Diagnostic and artifact semantics

A finding has structured identity and evidence; its rendered sentence is not a replacement for those fields. Drawing views display the rule/type. The checks viewer formats the full record and can copy it as Markdown. Preserve optional evidence fields when carrying findings between consumers.

The fabrication contract distinguishes generated files, checked output and stale retained output. `STATUS: ORDERABLE` describes the implemented checks; it does not validate electrical intent. PCB SVG is an export with the `https://pcb.svg/ns/1` metadata namespace, not a complete editable-source round trip.

## Compatibility boundaries

Protocol versions, browser-module format numbers, package versions and internal cache identities are separate mechanisms. There is no universal schema version that automatically makes every record compatible. Do not infer a portable interchange guarantee from a cache's JSON extension or a TypeScript interface's existence.

Most exact fields currently live in shared TypeScript declarations. The repository does not provide a complete language-neutral JSON Schema suite for every representation. A non-TypeScript integration must implement validation against the declared version and test fixtures; additional generated schemas remain a conformance improvement, not a shipped guarantee.

See [Conformance](../conformance) for schema checks, source/display equality, round-trip tests and release coverage.
