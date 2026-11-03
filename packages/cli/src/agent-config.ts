// What `pcbjs skills install` registers beside the skills: `pcbjs mcp` in each harness's MCP config, and the Claude Code plugin with the
// language server and the two hooks. docs/skills.md has the files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export const HARNESSES = ['claude', 'vscode', 'cursor', 'codex'] as const
export type Harness = (typeof HARNESSES)[number]

const RUN = ['--no-install', 'pcbjs']
const MCP = { command: 'npx', args: [...RUN, 'mcp'] }
export const PLUGIN_DIR = join('.claude', 'plugins', 'pcbjs')
const MARKET = 'pcbjs-project'

export interface AgentOptions {
  /** the harnesses asked for; the others are registered where their folder exists */
  mcp?: Harness[]
  claude?: boolean
  hooks?: boolean
}

export interface Written {
  file: string
  what: string
}

const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}
const writeJson = (file: string, v: unknown) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(v, null, 2) + '\n')
}
/** One key of a JSON file set, every other key kept. */
const merge = (file: string, path: string[], value: unknown) => {
  const doc = readJson(file)
  let at = doc
  for (const k of path.slice(0, -1)) at = at[k] && typeof at[k] === 'object' ? at[k] : (at[k] = {})
  at[path.at(-1)!] = value
  writeJson(file, doc)
}

/** The `[mcp_servers.pcbjs]` table of a Codex config, put in place of the one there, every other table kept. */
export function codexToml(text: string): string {
  const table = ['[mcp_servers.pcbjs]', `command = "${MCP.command}"`, `args = [${MCP.args.map(a => `"${a}"`).join(', ')}]`]
  const lines = text ? text.replace(/\n$/, '').split('\n') : []
  const at = lines.findIndex(l => l.trim() === '[mcp_servers.pcbjs]')
  if (at < 0) return [...lines, ...(lines.length ? [''] : []), ...table].join('\n') + '\n'
  const next = lines.findIndex((l, i) => i > at && /^\s*\[/.test(l))
  const end = next < 0 ? lines.length : next
  const blank = next < 0 ? [] : ['']
  return [...lines.slice(0, at), ...table, ...blank, ...lines.slice(end).filter((l, i) => i > 0 || l.trim())].join('\n') + '\n'
}

function registerMcp(cwd: string, h: Harness): Written {
  if (h === 'claude') {
    merge(join(cwd, '.mcp.json'), ['mcpServers', 'pcbjs'], MCP)
    return { file: '.mcp.json', what: 'mcp server' }
  }
  if (h === 'vscode') {
    merge(join(cwd, '.vscode', 'mcp.json'), ['servers', 'pcbjs'], { type: 'stdio', ...MCP })
    return { file: join('.vscode', 'mcp.json'), what: 'mcp server' }
  }
  if (h === 'cursor') {
    merge(join(cwd, '.cursor', 'mcp.json'), ['mcpServers', 'pcbjs'], MCP)
    return { file: join('.cursor', 'mcp.json'), what: 'mcp server' }
  }
  const file = join(cwd, '.codex', 'config.toml')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, codexToml(existsSync(file) ? readFileSync(file, 'utf8') : ''))
  return { file: join('.codex', 'config.toml'), what: 'mcp server' }
}

/** The harnesses to register: those asked for, Claude Code unless --no-claude, and each whose config or folder exists. */
export function harnessesOf(cwd: string, o: AgentOptions): Harness[] {
  const there: Record<Harness, boolean> = {
    claude: o.claude !== false || existsSync(join(cwd, '.mcp.json')),
    vscode: existsSync(join(cwd, '.vscode')),
    cursor: existsSync(join(cwd, '.cursor')),
    codex: existsSync(join(cwd, '.codex')),
  }
  return HARNESSES.filter(h => o.mcp?.includes(h) || there[h])
}

/** The Claude Code plugin: its manifest, the language server, the hooks unless `hooks` is false, and the project marketplace enabling it. */
function claudePlugin(cwd: string, hooks: boolean): Written[] {
  const dir = join(cwd, PLUGIN_DIR)
  writeJson(join(dir, '.claude-plugin', 'plugin.json'), { name: 'pcbjs', description: 'pcbjs findings after every edit, the editor events and messages each turn' })
  writeJson(join(dir, '.lsp.json'), {
    pcbjs: { command: 'npx', args: [...RUN, 'lsp', '--stdio', '--agent'], extensionToLanguage: { '.tsx': 'typescriptreact', '.ts': 'typescript' } },
  })
  const out: Written[] = [
    { file: join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), what: 'claude plugin' },
    { file: join(PLUGIN_DIR, '.lsp.json'), what: 'language server' },
  ]
  const hooksFile = join(dir, 'hooks', 'hooks.json')
  if (hooks) {
    const run = (a: string) => [{ type: 'command', command: `npx ${RUN.join(' ')} hook ${a}`, timeout: 30 }]
    writeJson(hooksFile, { hooks: { UserPromptSubmit: [{ hooks: run('prompt') }], PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: run('edited') }] } })
    out.push({ file: relative(cwd, hooksFile), what: 'hooks' })
  } else if (existsSync(hooksFile)) writeJson(hooksFile, { hooks: {} })
  const market = join(cwd, '.claude-plugin', 'marketplace.json')
  const m = readJson(market)
  writeJson(market, {
    ...m,
    name: m.name ?? MARKET,
    owner: m.owner ?? { name: 'pcbjs' },
    plugins: [...(m.plugins ?? []).filter((p: { name?: string }) => p.name !== 'pcbjs'), { name: 'pcbjs', source: `./${PLUGIN_DIR.split('\\').join('/')}` }],
  })
  const name = m.name ?? MARKET
  const settings = join(cwd, '.claude', 'settings.json')
  merge(settings, ['extraKnownMarketplaces', name], { source: { source: 'directory', path: '.' } })
  merge(settings, ['enabledPlugins', `pcbjs@${name}`], true)
  out.push({ file: join('.claude-plugin', 'marketplace.json'), what: 'plugin marketplace' }, { file: join('.claude', 'settings.json'), what: 'plugin enabled' })
  return out
}

export function registerAgents(cwd: string, o: AgentOptions = {}): Written[] {
  const out = harnessesOf(cwd, o).map(h => registerMcp(cwd, h))
  if (o.claude !== false || o.mcp?.includes('claude')) out.push(...claudePlugin(cwd, o.hooks !== false))
  return out
}
