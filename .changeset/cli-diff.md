---
'@pcbjs/cli': patch
---

`pcbjs diff <ref> [entries...]` compares each board of the working tree with the same entry at a git commit, compiled in a temporary worktree under the user cache: `before.png`, `after.png` and `diff.png` with removed copper red, added green and moved amber, and `diff.json` with the counts, every changed item by uid and reference, and the findings delta by fingerprint, in `.pcbjs/diff/<board>[~<target>]/`. `--view sch` compares the schematic by pixels, `--layer` and `--side` as in `shot`. It exits 1 when a tree fails to compile. docs/diff.md has the matching and the pull request workflow.
