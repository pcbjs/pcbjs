---
"@pcbjs/skills": patch
---

`install` links each skill from `.agents/skills`, the Agent Skills folder that Codex and Grok Build read, and from `.claude/skills` for Claude Code, as relative symlinks into `node_modules/@pcbjs/skills/<name>`, so the skills follow the installed version. It copies when the package is not in a project's `node_modules` or no symlink can be made, and says so. `--to <dir>` installs into that folder alone and `--no-claude` skips `.claude/skills`. `install(cwd, { to, claude })` returns each skill's kind and companion, and `installLine` formats it. Each skill now sits at the package root, `@pcbjs/skills/<name>` in place of `@pcbjs/skills/skills/<name>`, and the package exports `./*`.
