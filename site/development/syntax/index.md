---
title: Syntax and semantics
description: The accepted design language, evaluation rules, units, naming and source ownership.
---

# Syntax and semantics

pcbjs uses TypeScript expressions and JSX elements as its design language. It is not an independent text grammar that replaces TypeScript. This section specifies the pcbjs declarations, JSX vocabulary, string subgrammars and evaluation rules layered on that host language.

Start with [Projects and modules](./project) for config discovery, entry resolution and file structure.

## Language surfaces

| Surface | What is defined | Detailed contract |
| --- | --- | --- |
| Project and board | Configured entries, default-exported board root, presets, variants and scope | [Board roots](./board), [Stackups and defaults](./stackup), [Presets and variants](./fab) |
| Electrical declarations | Nets as values, parts, typed pins, connections, circuit ports and instances | [Parts, pins and nets](./schematic), [Circuits and layouts](./circuits) |
| Physical geometry | JSX elements, pads, drawings, text, placement attributes and transforms | [Elements and pads](./layout), [Footprints](./footprints), [Placement](./placement) |
| Coordinates | Units, position strings, angles, grid pitches, origins and subdivisions | [Units and layers](./board#units-and-coordinates), [Grids](./grids) |
| Routing | Chain cursor, primitive case, manual and automatic legs, vias and branches | [Route chains](./routing), [Routing options](./route-options) |
| Copper and constraints | Pours, stitching, pairs, length matching, patches and rule resolution | [Pours](./pours), [Pairs](./pairs), [Length](./length), [Patches](./patches), [Rules](./rules) |
| Display and naming | Schematic symbols and wires, references, sourcing and text | [Schematic drawing](./schematic-graphic), [Reference grammar](./refs), [Sourcing](./sourcing), [Fonts](./fonts) |

## Module structure and evaluation

An entry default-exports the board value. A config registers entries and supplies project-wide defaults. The recommended file names are conventions, not a separate grammar. JavaScript control flow, arrays, functions and top-level asynchronous setup remain host-language features.

JSX produces plain pcbjs nodes, not React components or a DOM. Compilation calls components and resolves the resulting tree. Runtime values such as nets and parts carry pcbjs identity; spelling an arbitrary string does not create a net connection.

A schematic module supplied through `schematic={sch}` exposes its exported design names to the board through the pcbjs source transform. Ordinary imports and local declarations also work. The TypeScript editor plugin supplies the matching editor scope; `pcbjs check` remains the project type-check path.

## Coordinates and transforms

| Rule | Meaning |
| --- | --- |
| Board coordinates | Millimetres by default; x right, y down |
| Explicit units | Supported length strings are converted before geometry; a grid does not erase an explicit unit |
| Grid-relative positions | Bare placement coordinates under a coordinate grid are pitches; route and drawing lengths retain their documented units |
| Group placement | Local geometry is transformed through the group's frame; its placement carries the board offset |
| Rotation | Positive angles turn counter-clockwise on screen; rotation is resolved in the local frame before placement translation |
| Back side | Mirroring and layer swapping are part of placement semantics, not merely a camera operation |
| Numeric validity | Converted lengths, positions and angles must be finite; dimensions such as pad/drill axes and via sizes must be positive where required |

Coordinate grids and editor snapping are distinct. A toolbar snapping change writes `grid.snap` without reinterpreting existing placement geometry. `maxLevel` bounds eligible editing subdivisions, defaulting to two. The full attribute contract is in [Grids](./grids).

## Composition, overrides and labels

A circuit declares its ports and returns its named members. Instantiations supply ports and an explicit index. Its private nets stay local to the instance. Naming and collision rules are part of the [circuit contract](./circuits), not implicit automatic numbering of arbitrary loops.

A layout can be declared with `schematic.layout(render, name?)`, or with the corresponding instance method for that instance. A child member placement at a layout call site overrides that member in the layout's local frame. A library edit changes the shared definition; an instance edit writes an override. Neither silently erases an existing override.

Generated reference-label controls use `ref:*` attributes such as `ref:at`. These attributes can target the label for focus without moving the footprint. The detailed attribute tables distinguish label placement from component placement. Do not infer an unrestricted nested override grammar for every visual subentity from the supported member-placement override syntax.

## Route-chain semantics

| Form | Cursor effect |
| --- | --- |
| `H(x)`, `V(y)`, `L(x, y)` | Absolute destination in the current coordinate frame |
| `h(dx)`, `v(dy)`, `l(dx, dy)` | Relative displacement from the current cursor |
| `A(...)`, `a(...)` | Absolute or relative arc destination with the specified turn |
| `via(layer)` | Insert a via at the cursor and continue on that layer |
| `X(point)` | Route automatically to a waypoint |
| `Z()` / `X()` | Finish at the declared end manually / automatically |

A chain that stops short of a declared destination gets an automatic final leg. A terminal `Z()` or `X()` cannot have later chain commands. Coordinate-only copper needs its net specified when appropriate. The [routing contract](./routing) defines valid endpoints, branches and combinations that are rejected.

## Errors and authoritative definitions

TypeScript checks names and argument shapes; runtime validation handles evaluated values and board-dependent constraints. A valid TypeScript program can still fail compilation because of an invalid frame, duplicate placement, missing member, cycle or illegal geometry. A compiled board can still have DRC/ERC findings. These outcomes are distinct.

Exact declarations live in [types.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/types.ts), [config.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/config.ts), [units.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/units.ts) and [ref.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/ref.ts). Each detailed page defines defaults and valid combinations for its surface. Compile/sample tests exercise examples; complete [guide examples](/guide/getting-started/) additionally render their actual compiled states.
