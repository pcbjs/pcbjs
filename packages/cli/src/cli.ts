import { cac } from 'cac'
import { dev } from './server.js'
import { devWorkspace } from './workspace.js'
import { build, preview } from './build.js'
import { ideInstall, ideStatus } from './ide.js'
import { createCommand } from './create.js'
import { check } from './check.js'
import { inspect } from './inspect.js'
import { modelAdd, modelAlign, modelCheck, modelFetch } from './model.js'
import { docs } from './docs.js'
import { skills } from './skills.js'
import { importCommand } from './import.js'
import { parseSize, shot } from './shot.js'
import type { InspectRequest } from './dev-reuse.js'
import { resolveConfig } from './config.js'
import { pluginState } from './plugin.js'
import { cliVersion, doctor, warnVersionSkew } from './doctor.js'
import { versionLine } from './version.js'
import { fabDate } from '@pcbjs/export/fab'

const cli = cac('pcbjs')
cli.usage(
  '<build|check|dev|preview> [entry...] [options]\n       pcbjs dev --workspace <folder>... [options]\n       pcbjs inspect [entry] [ref|net|REF.PAD|references|sch...] [--lengths [net|pair|group]] [--layer <name>] [--json]\n       pcbjs model add <file-or-url|lcsc:C123> [--ref [<board>/]<REF> | --footprint <name>] [--entry <board>] [--as <name>] [--write]\n       pcbjs model add --ref <REF> [--write], the model of its MPN:LCSC number\n       pcbjs model align [entry] [<board>/]<ref> [--file <model>]\n       pcbjs model check [entry...]\n       pcbjs model fetch [entry...]\n       pcbjs shot [entry...] [-o <dir>] [-p <port>] [--view 2d|3d|sch|both|all] [--select <ref>...] [--layer <name>...] [--side top|bottom] [--size WxH]\n       pcbjs import footprint <Lib:Name|file.kicad_mod> [-o lib/<name>.tsx] [--force]\n       pcbjs import board <file.kicad_pcb> [-o pcb.tsx] [--force]\n       pcbjs docs [topic] [--grep <word|regex>]\n       pcbjs ide <install|status>\n       pcbjs skills <install [--to <dir>] [--no-claude]|list|path>\n       pcbjs doctor\n       pcbjs create <dir> [--template board]\n\n  The entries are `entries` in pcb.config.ts, paths relative to it, globs allowed; entries on the command line win for that run.\n  Each entry is a .tsx or .ts module that default-exports <PCB>. Several entries make a multi-board site.\n  The current directory is the project root. The config is pcb.config.ts, .mts, .js or .mjs in it; pcbjs.config.* still loads with a warning.',
)

cli
  .command(
    'dev [...entries]',
    'dev server: compiles the boards, updates the viewer on every change, serves fab files on demand; --workspace serves every project under the folders',
  )
  .option('--workspace [folder]', 'serve every directory with a pcb.config.* under the folders, given here or as the arguments; each loads on first use')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-p, --port <port>', 'port (default 5173)')
  .option('--host [host]', 'listen on all addresses or the given one')
  .option('--open', 'open the browser')
  .option('--ide <url>', 'dial an editor host, ws://127.0.0.1:<port>/<token>, for the hosted IDE mode')
  .option('--ide-allow-remote', 'let --ide dial a host other than 127.0.0.1, localhost or [::1]')
  .option('--verbose', 'keep the stack of a compile error')
  .action(async (entries: string[], o) => {
    if (o.ide === true || o.ide === '') usageError('--ide needs a URL, for example --ide=ws://127.0.0.1:5220/<token>')
    warnVersionSkew()
    const common = { port: portOf(o.port), host: o.host, open: o.open, ide: o.ide, ideAllowRemote: !!o.ideAllowRemote, verbose: !!o.verbose }
    if (o.workspace !== undefined && o.workspace !== false) {
      if (o.config) usageError('--config names one project; with --workspace each project uses its own pcb.config.*')
      const given = (Array.isArray(o.workspace) ? o.workspace : [o.workspace]).filter((f: unknown) => typeof f === 'string' && f)
      const folders = [...given, ...entries].map(String)
      await devWorkspace({ folders: folders.length ? folders : ['.'], ...common })
      return
    }
    await dev({ entries, config: o.config, ...common })
  })

cli
  .command('build [...entries]', 'compile the boards, write the fab files and the static site; exit 1 on DRC or ERC errors')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--out-dir <dir>', 'site output (default .pcbjs/dist)')
  .option('-q, --quiet', 'print only the board lines, the findings and the total')
  .option('--verbose', "print every finding, Vite's output, the prerendered pages and the stack of a compile error")
  .option('--json <file>', 'write every board, its findings with stable ids, its fab set and pages to <file>')
  .option('--date <iso>', 'the date every fab file carries, such as 2026-01-31T12:00:00Z, so two builds of one tree are byte identical (default SOURCE_DATE_EPOCH, else now)')
  .action(async (entries: string[], o) => {
    if (o.date === true || o.date === '') usageError('--date needs a date, for example --date 2026-01-31T12:00:00Z')
    if (o.date !== undefined)
      try {
        fabDate(String(o.date))
      } catch (e) {
        usageError(`--date: ${(e as Error).message}`)
      }
    warnVersionSkew()
    await build({
      entries,
      config: o.config,
      outDir: o.outDir,
      quiet: !!o.quiet,
      verbose: !!o.verbose,
      json: jsonFile(o.json),
      date: o.date === undefined ? undefined : String(o.date),
    })
  })

cli
  .command('check [...entries]', 'compile and run DRC and ERC only: no fab files, no site; exit 1 on errors')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-w, --watch', 'recompile on every change and print what is new, fixed and unchanged')
  .option('-q, --quiet', 'the same output as without it; accepted for symmetry with build')
  .option('--verbose', "print every finding, unfolded and uncapped, Vite's output and the stack of a compile error")
  .option('--json <file>', 'write every board and its findings with stable ids to <file>')
  .option('--fab', 'also write the fab set in memory and read its copper and outline Gerbers back, as build does: a difference is a fab-mismatch error')
  .action(async (entries: string[], o) => {
    warnVersionSkew()
    const cfg = await resolveConfig(entries, 'build', o.config)
    if (o.fab) cfg.fabCheck = true
    process.exitCode = await check({ cfg, state: pluginState(cfg), watch: !!o.watch, quiet: !!o.quiet, verbose: !!o.verbose, json: jsonFile(o.json) })
  })

cli
  .command(
    'inspect [...queries]',
    'compile one board and print its frame and footprints, or each query: a ref with its pads, a net with its pads, vias and routes, a pad as REF.PAD; --lengths prints the route table; one compile answers them all',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-t, --target <name>', 'the target of a board with variants, by name or slug (default the first)')
  .option('--json', 'print JSON instead of text')
  .option('--lengths [filter]', 'print every route with its length, target, match group, status and source, or those of one net, pair or match group; repeat it for several')
  .option(
    '--layer <name>',
    'print every item on the layer, by id or alias, with its bounds, text, ref and source: strokes and glyphs of text, drawings, tracks, pours, pads; a query filters it by part or net; repeatable',
  )
  .option('--fresh', 'compile here even when a running dev server of the project holds a current board')
  .option('--verbose', "show Vite's output and the stack of a compile error")
  .action(async (args: string[], o) => {
    const layers: string[] = (o.layer === undefined ? [] : Array.isArray(o.layer) ? o.layer : [o.layer]).map(String)
    if (layers.some(l => l === 'true' || l === '')) usageError('--layer needs a layer, for example --layer F.SilkS')
    const { entry, requests } = inspectRequests(args.map(String), o.lengths, layers)
    process.exitCode = await inspect({ entry, requests, config: o.config, json: !!o.json, target: o.target, verbose: !!o.verbose, fresh: !!o.fresh })
  })

cli
  .command('shot [...entries]', 'PNG screenshots of the viewer with a headless Chrome: one per board, target and view, to .pcbjs/shots/<board>-<view>[-<options>].png')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-o, --out <dir>', 'output directory (default .pcbjs/shots)')
  .option('-p, --port <port>', 'port of the dev server the shots are taken from (default a free port)')
  .option('--view <view>', '2d, 3d, sch, both or all (default both, 2d and 3d; all adds the schematic)')
  .option('--explode <amount>', 'the exploded 3D view, 0 to 1 of the largest layer separation')
  .option('--layer <name>', 'show one layer alone in 2D, by id or alias, the outline kept; repeat it for one shot per layer')
  .option('--select <ref>', 'select a part and zoom to it: its courtyard in 2D, the camera on it in 3D; repeat it for one shot per part')
  .option('--fresh', 'compile here even when a running dev server of the project holds current boards')
  .option('--size <WxH>', 'page size in CSS pixels (default 1600x1000)')
  .option('--theme <theme>', 'light or dark (default the system theme of the headless browser, light)')
  .option('--side <side>', 'top or bottom: bottom views the board from below, the 2D view flipped to the back and the 3D camera under the board (default top)')
  .option('--flip', 'the same as --side bottom')
  .option('--verbose', "show Vite's output")
  .action(async (entries: string[], o) => {
    const view = o.view === undefined ? 'both' : String(o.view).toLowerCase()
    if (!['2d', '3d', 'sch', 'both', 'all'].includes(view)) usageError(`bad --view: ${o.view}, use 2d, 3d, sch, both or all`)
    const explode = o.explode === undefined ? undefined : Number(o.explode)
    if (explode !== undefined && !(explode >= 0 && explode <= 1)) usageError(`bad --explode: ${o.explode}, use a number from 0 to 1`)
    const size = o.size === undefined ? undefined : parseSize(String(o.size))
    if (size === null) usageError(`bad --size: ${o.size}, use WxH such as 1600x1000`)
    const theme = o.theme === undefined ? undefined : String(o.theme).toLowerCase()
    if (theme !== undefined && theme !== 'light' && theme !== 'dark') usageError(`bad --theme: ${o.theme}, use light or dark`)
    const side = o.side === undefined ? (o.flip ? 'bottom' : undefined) : String(o.side).toLowerCase()
    if (side !== undefined && side !== 'top' && side !== 'bottom') usageError(`bad --side: ${o.side}, use top or bottom`)
    if (o.flip && side === 'top') usageError('--flip views the bottom; give it or --side top, not both')
    const many = (v: unknown): string[] | undefined => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]).map(String))
    for (const k of ['out', 'layer', 'select'] as const) if (many(o[k])?.some(v => v === 'true' || v === '')) usageError(`--${k} needs a value`)
    if (Array.isArray(o.out)) usageError('give --out once')
    process.exitCode = await shot({
      entries,
      config: o.config,
      outDir: o.out,
      view: view as '2d' | '3d' | 'sch' | 'both' | 'all',
      explode,
      layer: many(o.layer),
      select: many(o.select),
      size,
      theme: theme as 'light' | 'dark' | undefined,
      side: side as 'top' | 'bottom' | undefined,
      verbose: !!o.verbose,
      port: portOf(o.port),
      fresh: !!o.fresh,
    })
  })

cli
  .command(
    'model <action> [...args]',
    "model files: `add <file-or-url|lcsc:C123>` copies or downloads one into models/ and fits it with --ref, and with --ref alone fetches the part's MPN:LCSC model; `align [entry] <ref>` prints the transform that puts a model on its pads; `check [entry...]` lists every model and flags missing, unread and misplaced ones; `fetch [entry...]` downloads the models the parts name, KiCad library, LCSC or URL, into .pcbjs/models/fetched",
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--ref <ref>', 'add: fit the model to this placed part and print its model option; `<board>/<ref>`, such as Sense/SW1, names its board')
  .option('--entry <entry>', 'add, align: the board the ref is on, by entry file, board name or folder; needed when the ref is on several boards')
  .option('--footprint <name>', 'add: fit the model to the first part with this footprint id, such as RJ45_JK0654219NL, and write it on the <footprint> element')
  .option('--as <name>', 'add: the file name in models/, the extension added when missing')
  .option('--write', 'add: write the model option into the code, the path relative to the file it is written in')
  .option('--force', 'add: replace a file of the same name with other content')
  .option('--file <model>', 'align: fit this file instead of the one the part uses')
  .option('--verbose', "show Vite's output and the stack of a compile error")
  .action(async (action: string, args: string[], o) => {
    const str = (v: unknown) => (v === undefined || v === true || v === '' ? undefined : String(v))
    for (const k of ['ref', 'footprint', 'as', 'file', 'entry'] as const) if (o[k] === true || o[k] === '') usageError(`--${k} needs a value`)
    const common = { config: o.config, verbose: !!o.verbose }
    if (action === 'add') {
      if (args.length > 1 || (!args.length && !o.ref))
        usageError('model add takes one file, URL or lcsc:<C-number>, or --ref alone for a part with an MPN:LCSC number: pcbjs model add <file-or-url> [--ref J1]')
      if (o.ref && o.footprint) usageError('give --ref or --footprint, not both')
      if (o.write && !o.ref && !o.footprint) usageError('--write needs --ref or --footprint')
      process.exitCode = await modelAdd({
        source: args.length ? String(args[0]) : undefined,
        ref: str(o.ref),
        entry: str(o.entry),
        footprint: str(o.footprint),
        as: str(o.as),
        write: !!o.write,
        force: !!o.force,
        ...common,
      })
    } else if (action === 'align') {
      if (args.length < 1 || args.length > 2) usageError('model align takes a ref, and an entry first when the config lists several: pcbjs model align [entry] <ref>')
      const [entry, ref] = args.length === 2 ? args.map(String) : [str(o.entry), String(args[0])]
      if (args.length === 2 && o.entry !== undefined) usageError('give the entry once, as the first argument or with --entry')
      process.exitCode = await modelAlign({ entry, ref, file: str(o.file), ...common })
    } else if (action === 'check') process.exitCode = await modelCheck({ entries: args.map(String), ...common })
    else if (action === 'fetch') process.exitCode = await modelFetch({ entries: args.map(String), ...common })
    else usageError(`unknown model action: ${action}, use add, align, check or fetch`)
  })

cli
  .command(
    'import <kind> <source>',
    'KiCad files as code: `import footprint <Lib:Name|file.kicad_mod>` writes a defineFootprint module, `import board <file.kicad_pcb>` a board skeleton with its schematic, copper, footprints and rules',
  )
  .option('-o, --out <file>', 'footprint: the module to write (default lib/<name>.tsx); board: the board file (default pcb.tsx), the others beside it')
  .option('--force', 'replace files that exist')
  .action(async (kind: string, source: string, o) => {
    if (o.out === true || o.out === '') usageError('--out needs a file')
    process.exitCode = await importCommand({ kind: String(kind), source: String(source), out: o.out === undefined ? undefined : String(o.out), force: !!o.force })
  })

cli
  .command('preview [...entries]', 'serve the built site')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-p, --port <port>', 'port (default 4173)')
  .option('--host [host]', 'listen on all addresses')
  .option('--out-dir <dir>', 'site to serve (default .pcbjs/dist)')
  .action(async (entries: string[], o) => {
    await preview({ entries, config: o.config, outDir: o.outDir, port: portOf(o.port), host: o.host })
  })

cli
  .command('ide <action>', 'the bundled VS Code extension: `ide install` installs it with the code CLI, `ide status` compares it with the installed one')
  .action(async (action: string) => {
    if (action === 'install') process.exitCode = await ideInstall()
    else if (action === 'status') process.exitCode = await ideStatus()
    else usageError(`unknown ide action: ${action}, use install or status`)
  })

cli
  .command(
    'skills <action>',
    'the agent skills of @pcbjs/skills: `skills install` links them from .agents/skills and .claude/skills, or from --to <dir> alone, into node_modules/@pcbjs/skills, `skills list` names each, `skills path` prints where they ship',
  )
  .option('--to <dir>', 'install: the one skills folder to link from, no .claude/skills links (default .agents/skills)')
  .option('--no-claude', 'install: skip the .claude/skills links beside .agents/skills')
  .action(async (action: string, o) => {
    if ((o.to !== undefined || o.claude === false) && action !== 'install') usageError('--to and --no-claude go with skills install')
    process.exitCode = await skills(action, { to: o.to === undefined ? undefined : String(o.to), claude: o.claude !== false })
  })

cli
  .command('docs [topic]', 'print the docs: the topic list, one topic such as routing, or with --grep every line that matches')
  .option(
    '--grep <word>',
    'print the lines of every topic, or of the one given, that mention <word>; anything but letters, digits, spaces and dashes is a regular expression, such as neck|escape',
  )
  .action((topic: string | undefined, o) => {
    if (o.grep === true || o.grep === '') usageError('--grep needs a word, for example --grep keepout')
    process.exitCode = docs({ topic: topic === undefined ? undefined : String(topic), grep: o.grep === undefined ? undefined : String(o.grep) })
  })

cli
  .command(
    'doctor',
    'print the installed @pcbjs versions, Node, Chrome, the step converter, the file format versions and the config; exit 1 when the packages disagree on major.minor',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .action(async o => {
    process.exitCode = await doctor({ config: o.config })
  })

cli
  .command('create [dir]', 'start a new project in <dir> from a template or an example: a board in pcb.tsx, pcb.config.ts listing it, package.json and tsconfig.json')
  .option('-t, --template <name>', 'template (default board)')
  .option('--example <name>', 'copy an example board instead of the template; --list-examples names them')
  .option('--list-examples', 'print the example boards with a line on each')
  .option('--layers <n>', 'copper layers, 2, 4, 6 or 8 (default 2)')
  .option('--fab <preset>', 'fab preset such as JLCPCB/4-Layer (default JLCPCB/<layers>-Layer)')
  .option('--size <WxH>', 'board size in mm, or the diameter of a circle (default 20x15, a circle 40)')
  .option('--outline <shape>', 'rect, rounded, rounded:<radius mm> or circle (default rounded, 1 mm corners)')
  .action((dir: string | undefined, o) => {
    const { template, example, listExamples, layers, fab, size, outline } = o
    createCommand(dir, { template, example, listExamples, layers, fab, size, outline })
  })

cli.help(sections => [{ body: versionLine() }, ...sections.slice(1)])
cli.version(cliVersion())
cli.outputVersion = () => console.log(versionLine())

/** 0 asks the system for a free port */
function portOf(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '' || v === true) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 65535) usageError(`bad port: ${v}`)
  return n
}

/** a bare --json would read the next entry as its file */
function jsonFile(v: unknown): string | undefined {
  if (v === undefined || v === false) return undefined
  if (v === true || v === '') usageError('--json needs a file, for example --json .pcbjs/report.json')
  return String(v)
}

/** The first argument is the entry when it names a module; a bare `--lengths` makes each query a filter, or adds the whole table. */
export function inspectRequests(args: string[], lengths: unknown, layers: string[] = []): { entry?: string; requests: InspectRequest[] } {
  const entry = args.length && looksLikeEntry(args[0]) ? args[0] : undefined
  const queries = entry === undefined ? args : args.slice(1)
  // --layer filters by each query; --lengths beside it adds its route tables
  if (layers.length) {
    const lengthFlags = (Array.isArray(lengths) ? lengths : [lengths]).filter(v => v !== undefined && v !== false)
    const tables = lengthFlags.map(v => (typeof v === 'string' && v !== '' ? { query: v, lengths: true } : { lengths: true }))
    return { entry, requests: [...layers.flatMap(layer => (queries.length ? queries.map(q => ({ query: q, layer })) : [{ layer }])), ...tables] }
  }
  const flags = (Array.isArray(lengths) ? lengths : [lengths]).filter(v => v !== undefined && v !== false)
  const filters = flags.filter(v => typeof v === 'string' || typeof v === 'number').map(String)
  const bare = flags.some(v => v === true || v === '')
  if (bare && !filters.length) return { entry, requests: queries.length ? queries.map(q => ({ query: q, lengths: true })) : [{ lengths: true }] }
  const requests: InspectRequest[] = [...queries.map(q => ({ query: q })), ...filters.map(q => ({ query: q, lengths: true })), ...(bare ? [{ lengths: true }] : [])]
  return { entry, requests: requests.length ? requests : [{}] }
}

/** A module ends in .ts, .tsx, .js, .mts and the like; anything else is a ref, net or pad. */
const looksLikeEntry = (a: string): boolean => /\.[cm]?[jt]sx?$/i.test(a)

function usageError(message: string): never {
  cli.unsetMatchedCommand()
  cli.outputHelp()
  console.error(`pcbjs: ${message}`)
  process.exit(1)
}

export async function run(argv = process.argv): Promise<void> {
  try {
    cli.parse(argv, { run: false })
    if (!cli.matchedCommand && !cli.options.help && !cli.options.version) usageError(cli.args[0] ? `unknown command: ${cli.args[0]}` : 'no command given')
    await cli.runMatchedCommand()
  } catch (e: any) {
    // the stack only when asked for
    const msg = String(e?.message ?? e).replace(/\x1b\[[0-9;]*m/g, '')
    console.error(`pcbjs: ${msg.split('\n')[0]}`)
    if (cli.options.verbose || process.env.DEBUG)
      console.error(
        String(e?.stack ?? '')
          .split('\n')
          .filter(l => /^\s+at /.test(l))
          .join('\n'),
      )
    process.exit(1)
  }
}
