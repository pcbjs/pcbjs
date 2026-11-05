# Live session and editing

## Tools first

When the pcbjs MCP tools are present, use them: they talk to the session that already compiled the board, see the editor's unsaved text, and need no shell. The CLI supplies board operations when MCP is unavailable, but does not establish a persistent agent inbox.

- Before the first edit, the connection owner calls the harness's `session` tool with the task and a plan of up to five lines. Confirm its returned agent connection and project; update `progress` as work proceeds. When workers share a connection, the coordinator owns task/progress and the inbox, and relays pending user corrections; workers must not overwrite the task or consume messages independently. A written config or one-shot handshake is not proof that this chat is listening.
- Keep the harness-owned MCP process alive for the task. Do not replace it with a script that starts MCP, makes requests and kills it. If tools are unavailable, say that agent messaging is unavailable and load the integration through the harness; do not claim the CLI fallback has enabled it.
- Check `events` before edits and after extended shell-only work. Messages arrive at the top of MCP tool results; only installed harness hooks supply them at a turn boundary. Logging notifications alone may not reach the model. Act on messages first; `query` or `render` their entity references such as `R1`, `CH2/R01/2`, `net:VCC` or a finding id.
- Change source with `write`, edits anchored on text you just read, or your harness's edit tool. Never overwrite an existing file with a whole-file Write: it loses the editor's unsaved text and every concurrent change.
- Coordinate one writer per file in a shared tree. Create worktrees only when task isolation needs them and the user's workspace policy permits it. Subagents alone do not require worktrees.

## The loop

1. Edit the board.
2. `check` [`npx pcbjs check`]: compile, route, DRC, ERC and a type check, no files written. Exit code 1 means not orderable.
3. Need a position or a detail? `inspect` with `U1`, `GND`, `U1/3` [`npx pcbjs inspect U1`], `query` for one record [`npx pcbjs q R1`]. Never compute rotated pad positions by hand and never read `board.json`.
4. Need to see it? `render` with `frame` and `highlight` [`npx pcbjs shot --select U1`, PNGs in `.pcbjs/shots`].
5. What changed since you looked: `events` [`npx pcbjs events --since <next>`].
6. When check is clean, `npx pcbjs build -q` writes `.pcbjs/fab/<board>/` with `README-fab.txt` saying `STATUS: ORDERABLE`.
