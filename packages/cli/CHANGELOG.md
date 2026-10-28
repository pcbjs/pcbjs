# @pcbjs/cli

## 0.0.1-beta.1

### Patch Changes

- [`cd7317f`](https://github.com/pcbjs/pcbjs/commit/cd7317fd3ab9b74fec8026ada0c1b2d7c3ec2754) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `pcbjs create` takes `--layers`, `--fab`, `--size` and `--outline` to pick the fab preset and draw the outline, with the template's circuit in the middle, and `--example <name>` to copy one of six example boards: blinky, coin, quad, multi, led-matrix and qfn-breakout. `pcbjs create --list-examples` prints them with a line each. Without the new flags `pcbjs create` gives the same board as before.

- [`c51b8d6`](https://github.com/pcbjs/pcbjs/commit/c51b8d6d5f777812e1af83b3b92d56c8bda6f4b1) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `pcbjs skills install` links each skill from `.agents/skills` and `.claude/skills` into `node_modules/@pcbjs/skills/<name>` instead of copying into `.claude/skills`, through `@pcbjs/skills`, and prints the same lines as its bin. `--no-claude` skips `.claude/skills`; `--to <dir>` installs into that folder alone.

- [`c51b8d6`](https://github.com/pcbjs/pcbjs/commit/c51b8d6d5f777812e1af83b3b92d56c8bda6f4b1) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `pcbjs shot` exits as soon as its files are written. It no longer waits minutes for Chrome's crash handler and updater, which keep Chrome's stderr open after Chrome quits, nor 3 s for a stale timer.
- Updated dependencies [[`7245cea`](https://github.com/pcbjs/pcbjs/commit/7245cea44558b589b236c8f3cd3100977ad36aab)]:
  - @pcbjs/export@0.0.1-beta.1

## 0.0.1-beta.0

### Patch Changes

- [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - First beta. The `pcbjs` command: check, build, dev, preview, inspect, shot, model, docs, doctor, create, import and ide, with the Vite plugin, the editor bridge, the project templates, the docs topics and the bundled VS Code extension.
  
  The source-range transform gives `stitch(net)` its range as an argument of its own.
- Updated dependencies [[`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6), [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6), [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6), [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6), [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6), [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6), [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6), [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6), [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6)]:
  - @pcbjs/compile@0.0.1-beta.0
  - @pcbjs/core@0.0.1-beta.0
  - @pcbjs/export@0.0.1-beta.0
  - @pcbjs/fab@0.0.1-beta.0
  - @pcbjs/kicad@0.0.1-beta.0
  - @pcbjs/lib@0.0.1-beta.0
  - @pcbjs/lsp@0.0.1-beta.0
  - @pcbjs/step@0.0.1-beta.0
  - @pcbjs/viewer@0.0.1-beta.0
