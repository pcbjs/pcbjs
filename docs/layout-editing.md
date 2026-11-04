# Layout editing

Choose whether an edit changes one instance or its reusable definition.
Advanced. Source tools: editing.md. Groups and overrides: circuits.md.

## Choosing a layout

Focus a group to show **Instance layout** and **Library layout** below the selection badges. Clicking inside the focused group enters instance editing. A standalone footprint can be isolated with `I`, but has no group-layout actions.

| Mode | Preview | Source edits | Leaving |
| --- | --- | --- | --- |
| Instance layout | The selected instance in board context | Own placements, creating overrides when needed | Clear member focus, click empty canvas or use Escape |
| Library layout | The independent template at its local origin, without surrounding board geometry or instance overrides | The shared layout definition; instance overrides remain | Escape or return to board source; clearing member focus keeps the library open |

Instance editing is shared by 2D and 3D. Library editing also isolates the schematic template, including its unplaced members and connections. Checks stays board-wide. Library parameter values may come from the focused instance, including required values without defaults. When source focus opens a declaration, the first matching instance supplies values if no matching instance is focused.

Library reference labels start at zero for each prefix, such as `R0`, `R1` and `D0`. Internal identities remain stable for source navigation and shared edits. Leaving library mode restores board references and the previous view, including after manual pan or zoom. Loading and retryable errors describe unavailable template geometry. Static sites need a live session to reconstruct a shared layout beneath instance overrides.

## Following source focus

Putting the caret inside an instantiated layout or circuit declaration enters library mode. Its declaration name, callback, JSX and coordinate attributes all belong to that context. A member such as `g.R` selects the template resistor. Imports and board-level calls do not activate library mode; returning to instance source restores board context.

Clicking a PCB library part selects its shared JSX element. In Blinky, the resistor in `LedChannelRow` maps to `<g.R at="-4mm 0" />` in `lib/led-channel.tsx`. Schematic clicks select schematic declarations. Route points select their generating chain calls; route-end assist offers handles from the declaration's render parameter.

## Source ownership

Placement edits write source. Compiler-generated routing may use a patch where no editable chain exists.

| Edit | Written as |
| --- | --- |
| Move or turn a part | Its own `at`, in the group's frame; rotation is appended when absent |
| Placement under a grid | Grid coordinates, such as `at="3 4.5"`; free dragging uses explicit mm |
| A coordinate with units | The same unit; `at="100mil 2"` keeps mil |
| An expression such as `at={at}` | A literal on that element; other users of the binding remain unchanged |
| A shared part in instance mode | An own placement inside that instance's layout element |
| A shared part in library mode | The shared layout element |
| A group instance | Its layout element's `at` and `side`; members follow |
| Text with its own source element | Its `at`; generated per-instance text may have no editable source |
| Flip to back or front | Add `side="B"` or remove it |
| Route control point | Update, insert or delete a chain call |
| Automatic leg with an editable chain | Insert `.X('x y')` |
| Shared or external automatic leg without an editable chain | A `reroute { through }` patch, patches.md |

For example, moving Blinky's R1 right by 1 mm in instance mode writes `<CH1.R at="-3mm 0" />` inside `<LedChannelRow g={CH1}>`. The same edit in library mode changes the shared `<g.R>` element and affects every instance that has no override.

Automatic placement slots and literals shared by loops or helpers can refuse dragging; the toolbar explains why. `pcbjs place --write` handles automatic placement. Source destinations and instance counts remain available as debugging details. Undo restores the source change; leaving the editing context does not discard history. Copied URLs retain `isolate-mode=instance|library`.
