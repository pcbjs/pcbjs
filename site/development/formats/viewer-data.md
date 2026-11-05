---
title: Viewer records and snapshots
description: Board references, facet records, source locations, packed geometry and query envelopes.
---

# Viewer records and snapshots

These records carry compiled data to a viewer or query consumer. Their field definitions are shared across Node, browser and editor integrations. This page documents the structure; [Communication](../communication/) specifies ordering, invalidation and replay.

## BoardRef

`BoardRef` is the result of a `?pcb:board` import, declared in [site-facets.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/site-facets.ts).

| Field | Shape / meaning |
| --- | --- |
| `kind` | Literal `pcbjs-board` |
| `format` | Literal `1`; the board-reference format, independent of the session protocol |
| `entry`, `board` | Entry path and board identity |
| `target` | Target name or `null` |
| `run` | Compile run that produced the reference |
| `summary` | Name, title, revision, copper count, bounds, view aspect ratios and counts |
| `facets` | Partial mapping from facet names to URLs; a missing key is not an empty facet |
| `module` | Optional browser-module URL |
| `poster` | Required 2D poster URL and optional schematic poster URL |
| `model`, `reference` | Optional built library-board model and reference-data URLs |
| `live` | Optional indication that the board is served by a development server |
| `session` | Optional session path and workspace scope; a `null` scope is explicit |

A `BoardRef` is an addressable description of available data, not a complete `Board`. Fetch the facets required by the view or compile the module using the supported browser path.

## Facet records

A `FacetHeader` identifies `entry`, `board`, nullable `target`, imported `facet`, `run` and content `hash`. A compiler `FacetOut` carries `board`, optional `target`, `facet`, ending `stage`, `hash` and `data`. Session messages add transport/run context through the protocol's facet message definition.

Do not copy a field's optionality from one record to another. In particular, a nullable target in `BoardRef` and an optional target in `FacetOut` are different declared shapes. The shared constructors and adapters perform the conversion.

A `FacetSet` groups the named facets of one board and nullable target. The [facet inventory](./#viewer-facets) and `FACETS` table define which `SiteData` fields belong to each facet. Facets stream independently and unchanged content can survive across runs. New shape exports carry `itemsHash`, the content hash of the exact item rows their numeric IDs describe. `joinSite` withholds shapes until the layer facet has matching rows, regardless of arrival order. This permits unchanged cross-run reuse without associating geometry with different entities. Legacy shapes without this additive field retain their existing behavior and do not provide this coherence check.

## Halted previews

The meta facet may carry `halted: { stage, stages, completed, src? }`: the failed stage, ordered stage names, completed stage names and optional one-based author source location. This identifies geometry recovered from the current source before the failing expression. It is distinct from `stale`, which identifies a previous successful board shown as a fallback. Consumers must show checks as incomplete even when `drc` and `erc` are empty. Halted previews have no export URLs or fabrication files and do not become successful query snapshots. A successful full compile removes `halted`.

## Mechanical reference transforms

Mechanical board references in the meta facet carry a column-major 4 × 4 `transform`, in millimetres with X = board X, Y = negative board Y and Z up from the carrier bottom. This remains the authoritative world transform for both the viewer and GLB export. The compiler accepts a complete `pose` with translation and quaternion orientation, normalizes it, and composes it with enclosing groups before emitting the matrix. Reference inspection also exposes the normalized input pose and transformed bounds; see [mechanical placement syntax](../syntax/references#quaternion-poses). Referenced copper and drills never join carrier fabrication items.

## Packed geometry

`SiteShapes` contains optional `itemsHash`, `rings`, `covered.F/B` and `openings.F/B`. Every entry is a `PackedRings` record:

| Array | Interpretation |
| --- | --- |
| `ids` | One numeric item ID per entry |
| `n` | Ring count for the corresponding item |
| `len` | Point count for each ring, concatenated in item order |
| `xy` | All points as alternating x and y values, in ring order |

A well-formed record has equal `ids`/`n` lengths, `sum(n) = len.length`, and `2 × sum(len) = xy.length`. Coordinates are finite board millimetres, y down. Outer rings have positive signed area; holes have negative signed area. The sparse numeric ID is a key, not the position of an item in a separate array.

`covered` records the masked portion of outer-copper items that have some opening; an omitted item is wholly covered. `openings` records mask openings by the item that opens them. Use [site-shapes.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/site-shapes.ts) for packing and lookup; its consumers do not constitute a universal untrusted-input schema validator.

## Source locations and identity

Compiler `Src` records contain `file`, one-based `line` and `col`, optional `endLine`/`endCol`, and optional source hash, segment and call-site metadata. The end range is present when the source-range transform provided it. An enclosing call chain is provenance distinct from the generating node's own source range.

LSP `Position` and `Range` use zero-based lines and UTF-16 characters. Converting a compiler location into a protocol range must account for that representation; never pass one shape off as the other.

A record may expose a human reference, UID and numeric ID for different tasks. References resolve through the [reference grammar](../syntax/refs). UIDs relate generated entities to source identity; numeric IDs address the current compile's item geometry. Both source edits and snapshot changes can require re-resolution.

## Query envelope

The protocol's `Envelope<T>` wraps the result:

| Field | Meaning |
| --- | --- |
| `snapshot` | Snapshot identity associated with the answer |
| `stale` | `null`, or a reason: `changed`, `compiling`, `failed`, `timeout` or `gone`; optional `current` names a resolved successor |
| `overlay` | Project-relative files whose unsaved text was compiled |
| `value` | The method's typed result |

A non-null stale state must remain visible to a consumer that makes edit or correctness decisions. The presence of data in `value` is not proof that the requested compile succeeded. Snapshot and cursor parsing is defined in [protocol.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/protocol.ts).

## Verification

Facet tests check producer/consumer correspondence, and browser equality checks compare the resulting facets with Node. The site source-map regression test covers sparse IDs explicitly. These tests should accompany a format change; they do not replace versioning or boundary validation for a new external consumer.

PCB footprints and schematic drawing symbols independently carry optional `locked: true`. Edit nodes also carry it when the node itself is locked or a group move would move a locked member. Clients retain selection and source navigation, hide placement tools and cancel active drags when a new snapshot locks their targets. The session enforces locks independently of client flags.
