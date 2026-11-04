---
'@pcbjs/vscode': patch
'@pcbjs/viewer': patch
'@pcbjs/cli': patch
---

Send to agent… in the editor's context menu, on a part in Boards, on a finding in Findings and on the viewer's selection chip sends the selection to an agent attached to the session as one message: the selected members as references, each editor selection as its range with what the language server resolves in it, a finding by its exact id, and the board, target and snapshot. It is greyed until an agent is attached; one agent gets it at once, several open a pick of name, task and age that remembers the last choice. The status bar says Sent to, then Read by once the agent's next tool result carried it, and a message the agent left unread comes back as Returned. A `pcbjs dev` page in a local browser offers the same on its chip and sends through the session.
