---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

`pcbjs mcp` is an MCP server on stdio for coding agents and `pcbjs lsp --stdio` the language server for any editor, both clients of the session that start one when none is live. The MCP server has ten tools, `check`, `inspect`, `query`, `render`, `script`, `docs`, `read`, `write`, `events` and `session`, resources for each board and its findings with subscriptions and standing queries, and returns the messages a human sent at the top of the next tool result. `pcbjs skills install` also registers `pcbjs mcp` in `.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json` and `.codex/config.toml` where each exists or `--mcp` asks, and writes a Claude Code plugin with the language server and two hooks, `pcbjs hook prompt` and `pcbjs hook edited`, which `--no-hooks` leaves out. The language server publishes diagnostics for every open document after each compile, empty when it is clean.
