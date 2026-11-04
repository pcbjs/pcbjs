# @pcbjs/ts-plugin

## 0.1.0

### Minor Changes

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Release pcbjs 0.1.0 with reusable schematic and layout definitions, synchronized 2D, 3D, schematic and DRC/ERC views, source-driven editing, and resilient editor sessions. Align every component and the bundled VS Code extension on the 0.1 release line.

### Patch Changes

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Every CLI flag has one form. `shot --side F|B` picks the side on top and `shot --view` repeats, 2D and 3D by default; `shot --fresh` compiles here even when a session is live. `dev --workspace` is a switch and its arguments are the folders. `inspect --references` and `inspect --sch` print those reports, and a pad is `REF/PAD`, inside an instance `CH2/R/1`. `model add` and `model align` name the board with `--entry`. `create` writes the one board template. The config file is `pcb.config.{ts,mts,js,mjs}`.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - One text-position model: `textDoc(text)` in `@pcbjs/core/internal/textdoc` converts between offsets, zero-based LSP positions and one-based source sites, applies LSP edits and computes the one edit between two texts. The language server's document model, the session's edits, undo, events log and drafts, and the CLI's model writer all read it, the TypeScript plugin leaves its line map to TypeScript, so a site or a cursor maps to the same offset everywhere, and a position past a line's end lands at that line's end.

- [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - First beta. A TypeScript language service plugin: in a file that passes `<PCB schematic={sch}>`, the editor sees every export of the schematic module by its bare name, with hover, completion, definitions, rename and errors.

## 0.0.1-beta.0

### Patch Changes

- [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - First beta. A TypeScript language service plugin: in a file that passes `<PCB schematic={sch}>`, the editor sees every export of the schematic module by its bare name, with hover, completion, definitions, rename and errors.
