---
'@pcbjs/vscode': patch
'@pcbjs/cli': patch
---

With several sessions attached, such as the window's own and those of worktrees, each one ran a language client over the whole workspace, so every session synced every open file and answered for it: unit hints showed once per session, `route('3mmmmmm 10mmmmmm')`, and hovers, code lenses, completions, code actions and findings repeated the same way. Each client now syncs and answers only the files its session serves, the session whose deepest root holds the file, and drops the findings of the others. When that session closes while another covers the file, the file moves to the other one at once, so hints, hovers and findings no longer stay empty until it is reopened.

The window's candidate projects are now those of its own checkout: a `pcb.config` under `.claude`, in a git-ignored folder or in another git worktree no longer makes the extension dial or start a session there, which had the owner's window attached to every worker session at once. The Worktrees node lists the worktrees from git without attaching any; Open board attaches that one worktree, which then shows as attached with a Detach action, through the new `session/detach` request of the session, and the Agents view lists the agents of a worktree only while it is attached.
