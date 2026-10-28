# @pcbjs/vscode

## 0.0.1-beta.1

### Patch Changes

- [`cd7317f`](https://github.com/pcbjs/pcbjs/commit/cd7317fd3ab9b74fec8026ada0c1b2d7c3ec2754) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - A "Get started with pcbjs" walkthrough on the Welcome page, with steps for creating a project, an example board, the preview, `pcbjs check`, inline values, KiCad conversion and the agent skills. Two new commands start a project: `pcbjs: New project from an example` copies one of the example boards, and `pcbjs: New board wizard` asks for the folder, layers, fab, outline and size with every step prefilled, so Enter through it gives a working board. `pcbjs: Run check` runs `pcbjs check` in a project and `pcbjs: Get started` opens the walkthrough.

- [`7245cea`](https://github.com/pcbjs/pcbjs/commit/7245cea44558b589b236c8f3cd3100977ad36aab) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - The extension carries the pcbjs mark as its Marketplace and Open VSX listing icon, with a dark gallery banner.

- [`944e5f3`](https://github.com/pcbjs/pcbjs/commit/944e5f351e1843f36f1a418a60df079ef0a07033) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Three commands start a project from VS Code: `pcbjs: Create project in workspace` runs `pcbjs create` and opens the new `pcb.tsx` with its preview, `pcbjs: Convert from KiCad` finds the workspace's `.kicad_pro` files, converts one with its `.kicad_pcb` beside it through `pcbjs import board` into a folder you confirm and opens it, and `pcbjs: Install skills` runs `pcbjs skills install` in a project, offering `npx @pcbjs/skills install` when `@pcbjs/skills` does not resolve. The Boards view shows all three in a workspace without a pcbjs project.

## 0.0.1-beta.0

### Patch Changes

- [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - First beta of the VS Code extension: runs the dev server of each project, shows 2D, 3D and schematic panes beside the editor, links cursor and selection both ways, adds a sidebar of boards, findings, nets and BOM, the language client, the TypeScript plugin and file icons.
- Updated dependencies [[`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6)]:
  - @pcbjs/ts-plugin@0.0.1-beta.0
