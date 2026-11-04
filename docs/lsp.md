# Language server

`pcbjs lsp --stdio`, the pcbjs language server for any editor and for coding agents: findings as diagnostics after every edit, hovers with previews and docs, definitions, lenses and hints.
Advanced. Read it to set up Neovim, Zed, Helix, a JetBrains IDE or Claude Code; VS Code needs none of this, editor.md has its extension, ide-bridge.md the protocol.

```sh
pcbjs lsp --stdio            # what an editor runs in the project folder
pcbjs lsp --stdio --agent    # what a coding agent's harness runs
```

## What it is

- A thin client of the session. On `initialize` it attaches to the live session of the workspace folder, else of the working directory, or starts one detached on a free loopback port, as session.md's starters do, and relays LSP's Content-Length framing between stdio and its connection. The language server itself runs in the session, one per connection, over the session's one document store.
- The connection is named by `clientInfo.name` of `initialize`. It has role `editor`, so the text it syncs is what compiles, or role `agent` with `--agent`, which syncs a file only while no editor holds it, session.md.
- When the session goes away it attaches to the next one and sends `initialize` and every open document again; the editor sees nothing but a pause.
- After each compile every open document gets its `textDocument/publishDiagnostics`, empty when its code made no finding, so an editor or an agent knows the check ran. Each finding with a source range is a diagnostic on that range, `source` `pcbjs DRC` or `pcbjs ERC`, its rule as `code`.
- Hovers show the 360 px preview, what the code drew, and last the docs excerpt for the prop, element, call or method under the cursor with a link to its topic, from an index the build writes into the package; highlight.md has what the cursor picks. editor.md lists every feature.

Run it beside the editor's TypeScript server, which still owns completion and type errors; `@pcbjs/ts-plugin` there makes the names `<PCB schematic>` brings into scope known, editor.md.

## Units

Every client gets the unit of each bare number as an inlay hint, a grid position's glyph with a location on its `defineGrid`, editor.md. A client without the `tokens` capability in `initializationOptions.pcbjs` also gets semantic tokens of the types `number`, `unit` and `layer` for the values inside coordinate strings, which Neovim, Zed and Helix merge with their TypeScript client's; link `@lsp.type.unit` and `@lsp.type.layer` to a highlight group to colour them. A client with `tokens`, as the VS Code extension, asks `pcbjs/tokens { textDocument, range? }` for `{ tokens: { range, type }[] }` and draws them itself.

## Neovim

Neovim 0.11 or later, in `init.lua`:

```lua
vim.lsp.config('pcbjs', {
  cmd = { 'npx', '--no-install', 'pcbjs', 'lsp', '--stdio' },
  filetypes = { 'typescript', 'typescriptreact' },
  root_markers = { 'pcb.config.ts', 'pcb.config.mts', 'pcb.config.js', 'pcb.config.mjs' },
})
vim.lsp.enable('pcbjs')
```

## Helix

In `languages.toml` of the project's `.helix/` or the user config:

```toml
[language-server.pcbjs]
command = "npx"
args = ["--no-install", "pcbjs", "lsp", "--stdio"]

[[language]]
name = "tsx"
language-servers = ["typescript-language-server", "pcbjs"]
```

## Zed

Zed starts a language server only through an extension that registers it; in a project's `.zed/settings.json` the binary of a server named `pcbjs` is set as:

```json
{
  "lsp": { "pcbjs": { "binary": { "path": "npx", "arguments": ["--no-install", "pcbjs", "lsp", "--stdio"] } } },
  "languages": { "TSX": { "language_servers": ["...", "pcbjs"] } }
}
```

## JetBrains

WebStorm and the other IDEs run it through the LSP4IJ plugin: Settings, Languages & Frameworks, Language Servers, add one named `pcbjs` with the command below, and map the file name patterns `*.tsx` and `*.ts` to it.

```sh
npx --no-install pcbjs lsp --stdio
```

## Claude Code

`pcbjs skills install` writes a project plugin whose `.lsp.json` runs the server for the agent, skills.md:

```json
{
  "pcbjs": {
    "command": "npx",
    "args": ["--no-install", "pcbjs", "lsp", "--stdio", "--agent"],
    "extensionToLanguage": { ".tsx": "typescriptreact", ".ts": "typescript" }
  }
}
```

Claude Code then gets the findings of every edit as diagnostics and can ask the server for hovers and definitions. The MCP server of mcp.md gives the same agent the checks, queries and renders as tools.
