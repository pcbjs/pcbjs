---
title: Set up the VS Code extension
description: Open synchronized pcbjs viewers beside your source and verify editing and navigation.
---

# Set up the VS Code extension

Install the extension bundled with your project's pcbjs version. This keeps the editor and preview server on the same protocol. Complete [npm setup](./npm-setup) first and open the project folder in VS Code.

## Install and connect

With VS Code's `code` command available in your terminal, run from the project folder:

```sh
npx pcbjs ide install
npx pcbjs ide status
```

Reload VS Code if prompted. The **pcbjs** activity bar opens the **Boards** list. Select a board to open its entry source and preview; the extension starts or joins the project's preview session automatically.

For a source checkout, build and package the extension first, then install that package:

```sh
npm run build
npm run package -w @pcbjs/vscode
node packages/pcbjs/bin/pcbjs.js ide install
```

Run these checkout commands from the repository root. The ordinary project commands above run from your board folder.

## Choose your views

Use the Command Palette to open **pcbjs: Open 2D view**, **pcbjs: Open 3D view**, **pcbjs: Open schematic view**, or **pcbjs: Open DRC/ERC view**. You can also open all four views together. Arrange them in editor groups beside the source.

Root-config boards appear directly in the Boards list. Other configs appear under their workspace-relative folder paths; expanding one shows its registered boards. Expanding a folder does not switch boards, and selecting the board already on screen does not reload its preview.

## Verify the editing loop

1. Select J1 in 2D. Its source expression should be highlighted in an existing source tab, or opened in a temporary tab.
2. Move the caret inside J1's placement expression. Eligible previews should focus the same part, including while the caret is inside `at`.
3. Move the part, then use the usual Undo and Redo keyboard shortcuts. The source and previews should agree after each operation.
4. Clear focus. A view that fitted itself to the selection should return to its previous camera position.

Opening source from a preview preserves the preview you clicked. New source tabs use VS Code's preview-tab behavior; pin a tab when you want to keep it. Unsaved edits remain protected by VS Code.

## Read findings in their own viewer

The **DRC/ERC** viewer contains readable finding details, an expandable list, previous/next navigation and a copy-as-Markdown action. Selecting a finding focuses its affected objects in every applicable preview. Drawing hover bubbles show only the finding type.

The findings viewer prefers the group showing PCB source, then another group without a preview, then an inactive preview group. It splits the editor only when the clicked preview is the only available group. Finding navigation reuses this viewer.

If a connection does not recover after a window reload, run `npx pcbjs ide status` and `npx pcbjs doctor` from the project before reinstalling. Keep the project package and extension versions aligned. See [Editor reference](/docs/editor) for connection settings and diagnostics.

Continue with [Define the schematic](./schematic).
