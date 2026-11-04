---
'@pcbjs/vscode': patch
'@pcbjs/cli': patch
---

The status bar shows the installed `@pcbjs/pcbjs` of the active editor's folder, in the warning colour on a version skew, or Not installed with a click that runs the install flow: the version the npm dist-tags give, `latest` or with a checkbox the newest of `latest`, `beta` and `next`, the packaged version offline, then `npm install -D` in a terminal. Get started gains an install step checked live, and the wizard asks the version first when pcbjs is missing. `pcbjs create` and the wizard write `.vscode/extensions.json` recommending `pcbjs.vscode-pcbjs`, and add it to a devcontainer's `customizations.vscode.extensions`.
