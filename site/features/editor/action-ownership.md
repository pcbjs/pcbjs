---
title: Project-bound editor actions
status: shipped
docs: editor-actions
fixture: examples/demo/blinky.pcb.tsx
view: 2d
flag: pcbjs ide install
evidence: packages/vscode/tests/action-owner.test.mjs
---

Sidebar and fabrication actions retain their project and target; pane undo uses the named source document's chronological history.
