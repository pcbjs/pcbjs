---
'@pcbjs/cli': patch
'@pcbjs/vscode': patch
---

Each git worktree gets its own session: a session writes no dev.json into another worktree it serves, its dev.json carries `checkout`, and a one-shot command or starter in another worktree no longer attaches to it. The extension attaches a worktree only when its board opens, so a repository with many worktrees no longer piles their projects into one session, whose watchers took so many file descriptors that every compile thread started after them failed with `spawn EBADF`.
