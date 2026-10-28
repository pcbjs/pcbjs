# @pcbjs/skills

## 0.0.1-beta.1

### Patch Changes

- [`c51b8d6`](https://github.com/pcbjs/pcbjs/commit/c51b8d6d5f777812e1af83b3b92d56c8bda6f4b1) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `install` links each skill from `.agents/skills`, the Agent Skills folder that Codex and Grok Build read, and from `.claude/skills` for Claude Code, as relative symlinks into `node_modules/@pcbjs/skills/<name>`, so the skills follow the installed version. It copies when the package is not in a project's `node_modules` or no symlink can be made, and says so. `--to <dir>` installs into that folder alone and `--no-claude` skips `.claude/skills`. `install(cwd, { to, claude })` returns each skill's kind and companion, and `installLine` formats it. Each skill now sits at the package root, `@pcbjs/skills/<name>` in place of `@pcbjs/skills/skills/<name>`, and the package exports `./*`.

## 0.0.1-beta.0

### Patch Changes

- [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - First beta. Agent skills for designing boards with pcbjs, in the Agent Skills format, and the `pcbjs-skills` installer.
