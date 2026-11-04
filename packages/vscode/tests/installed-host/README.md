# Installed VS Code acceptance

Installed-host checks against an explicitly supplied candidate VSIX and a fully built checkout. This runner installs into temporary extensions and user-data directories, creates scratch copies of Demo and Badge, launches a separate Code process, and cleans up only its own session PIDs and directories.

## Local headless Linux verification

Installed-host acceptance runs locally, not in GitHub Actions. The Linux runner executes the complete suite in a private Xvfb display with Openbox and D-Bus. No computer-control tools, owner desktop or unlocked Mac are required.

On a Linux machine with Node, Xvfb, xauth, Openbox, D-Bus and VS Code's desktop libraries installed:

```sh
npm ci
npm run build
npm run package -w @pcbjs/vscode
npm run test:vscode:headless -- --code /path/to/VSCode-linux-x64/code --repo "$PWD" --vsix "$PWD/packages/cli/vscode/vscode-pcbjs.vsix" --out /tmp/pcbjs-vscode-report
```

Pass the Electron executable to `--code`; its sibling `bin/code` is used for installation, or supply `--cli` explicitly. Node is taken from the running test process. Headless mode rejects diagnostic subsets and requires full-suite completion. It uses software rendering and the isolated-runner sandbox flags used by Microsoft's extension test runner; use a dedicated local test environment.

The chosen output directory retains `host-results.json`, VS Code version, candidate SHA256, screenshots, copied Markdown, session logs and cleanup records, including on failure. Supply the VS Code installation to test; its version is recorded so failures can be reproduced. A failed assertion or incomplete suite exits nonzero.

This is real Linux Electron and extension-host coverage, including Ctrl+Z/Ctrl+Shift+Z, clipboard and focus. It does not certify macOS Cmd shortcuts, macOS window-manager behavior, Windows, or hardware GPU rendering. Keep focused native checks for OS-specific changes. Record the candidate revision, VS Code version and result for each run.

## Optional: macOS desktop acceptance

```sh
/opt/homebrew/bin/node packages/vscode/tests/installed-host/run.mjs --vsix /path/to/vscode-pcbjs.vsix --repo /path/to/built-clean-checkout --out /tmp/pcbjs-host-report
```

The tiny development extension is a test driver. `pcbjs.vscode-pcbjs` itself is loaded from the installed VSIX. Checks use the actual VS Code API for tabs, editor buffers, commands, tab groups and QuickPick cancellation. Real WorkspaceEdit and TextEditor.edit calls with explicit undo stops construct the chronological source history; they are editor API insertions rather than physical key typing. A private ephemeral CDP connection sends actual Mod+Z and Mod+Shift+Z key events to the focused installed viewer and verifies source-buffer changes, chronological repeated undo/redo after preview reload, restored pane group focus, and a preview-origin pointer selection plus R rotation. Mod is Command on macOS and Control on Linux. The multi-document refusal check separately invokes the installed webview bridge. A probe first raises the private workbench, clicks blank board canvas and verifies actual child-board focus. This exercises the installed action rather than a fake host, but does not claim native menu rendering or exhaustive editor acceptance. For this optional macOS mode, the Mac must be unlocked; a locked desktop leaves stale focus flags in native editors and cannot produce a valid keyboard result. No owner profile, window or server is accessed.

The persistent DRC/ERC viewer is checked as the fourth shared server viewer, with a standard preview tab and an inner `?view=checks` page. Checks cover readable HTML, icon-only Copy as Markdown, real clipboard output with prior clipboard restored, and entity selection through the page's normal handlers. CDP DOM clicks are programmatic event dispatch, not physical pointer input; the harness never bypasses the page by posting bridge messages directly.

Native group checks preserve the active board preview while preferring a source group, then an inactive preview group, then a new split. Source focus and null finding focus keep the checks pane and list. Previous/next, list selection and list collapse reuse the same native tab and iframe document; closing the last checks pane clears canonical focus. Open All Views must include 2D, 3D, Schematic and DRC/ERC. HTML, text, screenshots and copied Markdown are saved beside the report.

The optional `--finding-groups-only` flag is a diagnostic mode that skips the three existing native undo, redo and modal Quick Input checks. Final acceptance uses the default full suite.

On macOS the runner activates its own spawned process by PID before checking native focus. CDP window raising alone does not activate a separate Code process. The pad-hint fixture also scrolls its caret into view; native parameter hints are hidden when their anchor is offscreen. Both are test preconditions, not product workarounds. CDP connection and request timeouts prevent a closed host from leaving the runner waiting indefinitely.
