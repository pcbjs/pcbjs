# File icons

File and panel icons in the language of the pcbjs mark: the 9c3 chip with pads through the body edge and one glyph inside, drawn on a 512 grid so pads, gaps and orthogonal glyph edges land on whole pixels at 16 and 32 px.

## Files

- `<name>.svg` switches its body through `prefers-color-scheme`: dark mask `#0F2219` on light, green mask `#1E6B46` on dark. It follows the OS, not the editor theme, so use it only where the page itself switches.
- `light/<name>.svg` has the dark mask body and `dark/<name>.svg` the green mask body, with no media query. Editors take these as the light and dark pair, and `dark/` is also the static fallback for any raster render, as `static.svg` is for the mark.
- `mono/<name>.svg` is one colour in `currentColor`: the body as an outline through solid pads, the glyph solid.

## Mapping

| Icon | Glyph | Use for |
| --- | --- | --- |
| `entry` | the brand prompt `>_` | board entries: every file in `entries` of `pcb.config.ts`, and by name `pcb.tsx` and `*.pcb.tsx` |
| `config` | 4-tooth cog with square teeth and a centre hole, on the pixel grid | `pcb.config.ts`, `.mts`, `.js`, `.mjs`, and the old `pcbjs.config.*` |
| `schematic` | op-amp triangle with two inputs, centred | `*.sch.ts` and `*.sch.tsx` |
| `footprint` | pad pair | footprint and library modules: `*.tsx` and `*.ts` under a project's `lib/` folder, and any module that calls `defineFootprint` |
| `fab` | layer stack | fab output: the `.pcbjs/fab` folder and each `.pcbjs/fab/<Board>` folder in it, and the fab zip |
| `preview` | magnifier: lens and handle | each viewer webview panel tab, 2D, 3D and Schematic, in place of a `pcbjs:` prefix |

- Order matters where patterns overlap: `config` first, then `schematic`, then `entry`, then `footprint`; an entry listed in `entries` wins over the `lib/` rule.
- The webview tab takes `panel.iconPath = { light: <light/preview.svg>, dark: <dark/preview.svg> }` as `vscode.Uri`s into the extension's bundled copy of this folder; the title is then the board and the view, `Blinky | 3D`.
- `preview` uses the magnifier rather than the prompt so the viewer tab and the `pcb.tsx` editor tab differ at a glance when both are open; both read at 16 px beside text.
- VS Code shows file and folder icons only through a file icon theme, which replaces the user's theme, so the extension offers them as an opt-in theme and marks the same files under any theme with an explorer badge in the wordmark orange; the panel icon needs neither.
- The activity bar container uses `../mark-mono.svg`, which VS Code masks to one colour.

## Rules

- Keep the chip, pads and body radius identical across icons; only the glyph changes.
- A glyph stays inside 96 to 416 on both axes, clear of the pads' inner halves, and keeps straight edges on multiples of 32 so it holds at 16 px. Diagonals, such as the chevron and the magnifier handle, soften at 16 px but must stay recognisable.

## Alternatives

`alt/<name>-<n>/` is the record of the redesigns of `preview`, `config` and `schematic`. The owner picked `preview-1` without its trace, `schematic-2` centred, and a cog: `cog-4`, `cog-6` and `cog-8` are 8 by 8 pixel cogs, and the 4-tooth one shipped because the 6 and 8 tooth ones read as noise at 16 px. Each folder has `icon.svg`, which switches, and `light.svg`, `dark.svg` and `mono.svg`. A braces glyph for config and a crossover jump for schematic smeared at 16 px and were dropped, as were a layered-sheets preview, a 45 degree wrench and a resistor zigzag.

| Folder | Glyph | 16 px |
| --- | --- | --- |
| `preview-1` | magnifier lens over a copper trace corner | readable, lens soft; shipped without the trace |
| `preview-2` | board outline with one via and a trace | crisp |
| `preview-3` | cyan play triangle facing a board edge | crisp, the boldest; reads close to a media control |
| `config-1` | three sliders with copper knobs | crisp |
| `config-2` | 4-tooth cog with square teeth and a hole | crisp, reads as a gear |
| `schematic-1` | net with a junction dot and a stub | crisp |
| `schematic-2` | op-amp triangle with two inputs | crisp; shipped, centred |
| `cog-4`, `cog-6`, `cog-8` | pixel cogs with a centre hole | 4 teeth crisp, shipped; 6 and 8 noisy |
