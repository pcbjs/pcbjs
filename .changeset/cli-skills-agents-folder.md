---
"@pcbjs/cli": patch
---

`pcbjs skills install` links each skill from `.agents/skills` and `.claude/skills` into `node_modules/@pcbjs/skills/<name>` instead of copying into `.claude/skills`, through `@pcbjs/skills`, and prints the same lines as its bin. `--no-claude` skips `.claude/skills`; `--to <dir>` installs into that folder alone.
