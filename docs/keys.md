# Keys

Every key and pointer gesture the viewer honours, one table that the views, the command palette and this page all read, so they cannot disagree; every other chord, cmd or ctrl P among them, passes untouched to the browser or the editor.
Advanced. viewer.md has the views, editing.md the tools and the assist mode they act on.

```sh
npm run dev   # then / opens the palette, ? the key map
```

## The palette and the key map

`/` opens the command palette: every command with its keys, a search over titles and keys, arrows to move, Enter to run, Escape to close. `?` shows the key map below over the view. Keys never fire while a text field has focus, and `Mod` is cmd on a Mac and ctrl elsewhere. The Editor keys act in VS Code: `npm run build -w @pcbjs/vscode` writes them into the extension's `keybindings` from this table, and the palette leaves them out.

## The modifier contract

pcbjs uses these modifiers: shift+click extends or toggles the selection; cmd or ctrl+click selects the leaf; a double-click enters a group one level and Escape goes up; during a drag shift lifts snapping and cmd or ctrl keeps it to one axis, on the ring shift gives 5 degree stops; alt+click, option on a Mac, opens the definition of what a click selects and keeps the selection; rotation is never a held key, `R` turns one stop and the ring turns freely; Isolate is `I` or the chip's button.

## The map

<!-- generated from packages/ui/src/keys.ts: begin -->

### Everywhere

| Key | Does | Views |
| --- | --- | --- |
| `/` | Open the command palette | 2D, 3D, Schematic, DRC/ERC |
| `?` | Show the key map | 2D, 3D, Schematic, DRC/ERC |
| `V` | Cycle the view: 2D, 3D, schematic, DRC/ERC | 2D, 3D, Schematic, DRC/ERC |
| `G` | Show or hide the grid | 2D, 3D, Schematic |
| `N` | Show or hide the ratsnest and the connection indicators | 2D, 3D, Schematic |

### Board views

| Key | Does | Views |
| --- | --- | --- |
| `F` | Fit the board or the sheet | 2D, 3D, Schematic |
| `+` or `=` | Zoom in | 2D, 3D, Schematic |
| `-` | Zoom out | 2D, 3D, Schematic |

### Selection

| Key | Does | Views |
| --- | --- | --- |
| `Escape` | Cancel a drag, leave assist mode, go up inside an isolation, leave it, else clear the selection | 2D, 3D, Schematic |
| `I` | Isolate: edit the definition of the selected instance, or leave it for the board | 2D, 3D, Schematic |
| `Shift+Click` | Add to the selection or take out of it | 2D, 3D, Schematic |
| `Mod+Click` | Select the leaf under the pointer, past its groups | 2D, 3D, Schematic |
| `Alt+Click` | Open the definition of what a click selects, its factory or declaration, in the editor; the selection stays | 2D, 3D, Schematic |
| `Double-click` | Enter the definition of the instance under the pointer, the part clicked selected; a click on the selected instance does the same | 2D, 3D, Schematic |

### Tools

| Key | Does | Views |
| --- | --- | --- |
| `M` | Move tool | 2D, 3D |
| `R` | Rotate the anchor 90 degrees | 2D, 3D |
| `L` | Put the anchor on the other side | 2D, 3D |
| `P` | Control point tool of a route | 2D, 3D |
| `Delete` or `Backspace` | Delete the picked control point | 2D, 3D |
| `Mod+Z` | Undo: source document history in the editor, else this page’s last edit | 2D, 3D, Schematic |
| `Mod+Shift+Z` | Redo: source document history in the editor, else this page’s last undo | 2D, 3D, Schematic |

### Drag

| Key | Does | Views |
| --- | --- | --- |
| `Shift+Drag` | Move or point: no snapping; ring: 5 degree stops | 2D, 3D |
| `Mod+Drag` | Move or point: lock to one axis; ring: no snapping | 2D, 3D |

### Assist

| Key | Does | Views |
| --- | --- | --- |
| `Shift` | Every grid dot; a pick writes l when its trace is clean, else X | 2D, 3D |
| `Click` | Write the dot as the argument the editor waits for | 2D, 3D |

### Editor

| Key | Does | Views |
| --- | --- | --- |
| `Mod+Alt+2` | Open the 2D view beside the code | VS Code |
| `Mod+Alt+Shift+2` | Open another 2D view beside the code | VS Code |
| `Mod+Alt+3` | Open the 3D view beside the code | VS Code |
| `Mod+Alt+Shift+3` | Open another 3D view beside the code | VS Code |
| `Mod+Alt+S` | Open the schematic view beside the code | VS Code |
| `Mod+Alt+Shift+S` | Open another schematic view beside the code | VS Code |
| `Mod+Alt+4` | Open the DRC/ERC view beside the code | VS Code |
| `Mod+Alt+Shift+4` | Open another DRC/ERC view beside the code | VS Code |
| `Mod+Shift+R` | Restart the server and clear every cache, while a preview tab is active | VS Code |

<!-- generated: end -->
