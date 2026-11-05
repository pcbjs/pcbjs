# MCP

`pcbjs mcp`, the MCP server on stdio that gives a coding agent the session's checks, queries, renders, docs and source edits as tools, and its boards and findings as resources.
Advanced. Read it to connect an agent harness that speaks MCP, Claude Code, Codex, Cursor or VS Code, or a host with no shell; skills.md registers it, session.md has the session behind it.

```sh
pcbjs skills install          # registers it in .mcp.json and every harness config that exists, see skills.md
pcbjs mcp                     # what a harness runs, from the project folder
```

## The server

- It speaks MCP over stdio, one JSON-RPC message per line, protocol versions 2025-06-18, 2025-03-26 and 2024-11-05; stdout carries only messages, its own lines go to stderr.
- It is a thin client of the session: `initialize` succeeds after attaching to the live session of its folder, or starting one detached on a free loopback port. Attachment failure fails initialization. The harness must keep the stdio process open for the task.
- If the session disconnects, the MCP process looks for a returning session every two seconds, even with no resource subscriptions or tool calls, and restores its task/plan/progress. Background retries do not restart a deliberately stopped server; an explicit tool request may start one. Closing stdin cancels retries and detaches.
- The connection has role `agent` and the name the harness gave in `clientInfo.name` of `initialize`, such as `claude-code`, and declares `findings`, so an edit compiles while the agent is attached. `session/clients` lists it with its folder and start time.
- The server's instructions ask the agent to call `session` with its task and plan before its first edit and to update its progress, to check after each change, and never to overwrite an existing file whole.

The instructions also favor focused workers for independent tasks when the harness permits delegation. The coordinator owns task/progress and pending messages on a shared connection; workers return compact decisions and verification evidence. Documentation loads progressively: list topics first, then request the relevant topic or search within it. These are agent workflow instructions, not server-enforced scheduling.

## Tools

Each description is one line; `pcbjs docs <topic>`, or the `docs` tool, has the detail. Every answer names its snapshot.

| Tool | Arguments | Does |
| --- | --- | --- |
| `check` | `entries?` | `pcbjs check` as it prints, the type check included, then `exit <code>`; check.md |
| `models` | `entries?` | `pcbjs model check` inventory and fit/geometry validation, with structured model rows and per-mesh issue counts; models.md |
| `inspect` | `entry?`, `refs?`, `lengths?`, `target?` | `pcbjs inspect` for each reference, `lengths` true or a net, pair or group; inspect.md |
| `query` | `reference`, `board?`, `target?` | the record of one reference in its envelope, `pcbjs q`; queries.md |
| `render` | the render spec | the PNG as an image and the one-line legend; render.md |
| `script` | `code`, `board?`, `target?`, `timeout?` | the output of a read-only expression against the board API; queries.md |
| `docs` | `topic?`, `grep?` | the topic list, one topic, or every matching line |
| `read` | `file`, `start?`, `end?` | a file as the session compiles it: an editor's unsaved text, else disk, and which |
| `write` | `file`, `edits?`, `text?` | each edit `{ old, new }` replaces `old`, which must occur exactly once; `text` only creates a new file |
| `events` | `since?`, `wait?`, `for?`, `timeout?`, `kind?`, `scope?` | the events since the last call, or `since`, as JSON lines ending `{ next }`; `wait` blocks for the kinds in `for`, 60 s by default |
| `session` | `task?`, `plan?`, `progress?` | records what the agent does, then the session, its projects and clients |

- `write` goes through `Sources` of session.md: the editor that holds the file applies it by `workspace/applyEdit`, else any editor of the project, and only with none attached is the file written on disk. The edit event names the agent and its task.
- `session` takes a task of one line, a plan of up to five lines and a progress line. Each call is a `message` event to the editor, so the human sees the plan before the first edit and can redirect; `session/clients` and every event the agent causes carry the task as `by.task`.
- A tool that fails returns its message with `isError`; findings are no failure, the check's exit code says them.
- `models` returns `{ stdout, exitCode, models }` in a snapshot envelope and sets `isError` when a model is flagged. It reads the same settled source as other session queries, including editor overlays. Use `render` to check appearance; mesh validation does not certify mechanical or electrical correctness.

## Messages

- A human sends a message to an agent with Send to agent… in the editor, a tree or the viewer's chip, vscode.md, as `session/send { to, refs, ranges, finding, comment, board, target, snapshot }` from `editor`: the session logs a `message` event, queues it for that connection and sends it at once.
- `refs` is one list in the reference grammar of refs.md: the selected members of the viewer or the trees, the members the language server resolved in each editor selection, finding ids. `ranges` are the editor selections, 1-based with `endCol` inclusive; `finding` is a Findings row's exact id; `snapshot` is the one the human looked at, so `query` and `inspect` answer about what they saw.
- A `pcbjs dev` page in a browser, a read-write session client, sends the same: the session lists its agents to such pages as `pcbjs:agents`, the page calls `session/send { to, comment, board, target, refs, snapshot }` and follows `session/events` of kind `delivered` for read or returned.
- The server sends it on as an MCP logging notification, level `notice`, for harnesses that surface those, and returns it at the top of the next tool result, before the tool's own content, as `pcbjs message <id> from <name>: <comment>` with a line each for refs, finding, ranges and board. Returning it acknowledges it: `session/ack`, and a `delivered` event the editor shows as read.
- A message the prompt hook of skills.md showed first is acknowledged there, and the server forgets it. One the agent never read when its connection closes is `delivered` with `returned: true`.
- A harness that polls runs `pcbjs events --wait --for message`.

An active chat, a configured MCP server and a connected agent are different states. Only a live `agent` connection is a relay recipient. CLI event polling can observe the event log but does not register such a recipient. A relay acknowledgement means the message was handed to tool output or a hook, not proof that the model acted on it. Logging notifications alone may only reach a host's log panel; use MCP `events` before edits and after long shell-only work for reliable consumption. Messages are connection-scoped, not a durable inbox for an offline chat; unconsumed messages are returned when that connection closes.

## Resources

| URI | Holds |
| --- | --- |
| `pcbjs://<board>/board` | the board's `inspect` text: parts, nets and positions |
| `pcbjs://<board>/findings` | every finding of the board with its id and evidence, JSON |
| `pcbjs://<board>/findings?scope=<pattern>` | the findings whose id or refs fall under the pattern, `CH2/*`, `net:VCC`, `drc:clearance:*`; the parameter repeats |
| `pcbjs://<board>/watch?script=<expr>` | the output of a `script` expression, a standing query |

- `resources/list` names the board and findings resources of every board; `resources/templates/list` the scoped findings and the watch.
- `resources/subscribe` on any of them follows the session's `findings` events: after each check of that board the server reads the resource again and sends `notifications/resources/updated` only when its content changed, the snapshot id left out of the comparison. A subscription lives as long as the server; `resources/unsubscribe` ends it.

## Without a session

Hosts with no shell reach pcbjs only through this server. The tools need the session, which the server starts itself; `pcbjs session stop` in the project ends it, and it ends on its own after the idle grace once the server exits.
