import { cac } from 'cac'
import { resolve } from 'node:path'
import { devCommand, sessionServe, sessionStatus, sessionStop } from './session/commands.js'
import { EDIT_MODES, type EditMode } from './session/frames.js'
import { build, preview } from './build.js'
import { ideInstall, ideStatus } from './session/ide.js'
import { createCommand } from './create.js'
import { check } from './check.js'
import { failedReport, writeReport } from './project/report.js'
import { sessionCheck } from './check-session.js'
import { q } from './q.js'
import { repl, script } from './script.js'
import { events } from './events.js'
import { addTests, runTests, testReport } from './test-run.js'
import { inspect } from './inspect.js'
import { patchHold } from './patch.js'
import { placeCommand } from './place.js'
import { modelAdd, modelAlign, modelCheck, modelFetch } from './model.js'
import { modelCache } from './model-cache.js'
import { docs } from './docs.js'
import { skills } from './skills.js'
import { mcp } from './mcp.js'
import { lspStdio } from './lsp-stdio.js'
import { hook } from './hook.js'
import { HARNESSES, type Harness } from './agent-config.js'
import { importCommand } from './import.js'
import { parseSize, shot, SHOT_VIEWS, type Look, type ShotView } from './shot.js'
import { parseSpec } from './render/spec.js'
import { diff } from './diff.js'
import type { InspectRequest } from './project/dev-reuse.js'
import { resolveConfig } from './project/config.js'
import { pluginState } from './server/site.js'
import { cliVersion, doctor, warnVersionSkew } from './doctor.js'
import { versionLine } from './version.js'
import { uiSource } from './server/vite-config.js'
import { fabDate } from '@pcbjs/export/internal/fab'

const cli = cac('pcbjs')
cli.usage(
  '<build|check|dev|preview> [entry...] [options]\n       pcbjs dev --workspace [folder...] [options]\n       pcbjs session <serve|stop|status> [entry|folder...] [options]\n       pcbjs inspect [entry] [ref|net|REF/PAD...] [--lengths [net|pair|group]] [--layer <name>] [--references] [--sch] [--grids] [--json]\n       pcbjs model add <file-or-url|lcsc:C123> [--ref <REF> | --footprint <name>] [--entry <board>] [--as <name>] [--write]\n       pcbjs model add --ref <REF> [--write], the model of its MPN:LCSC number\n       pcbjs model align <ref> [--entry <board>] [--file <model>]\n       pcbjs model check [entry...]\n       pcbjs model fetch [entry...]\n       pcbjs patch hold <route> [--entry <board>]\n       pcbjs place [entry...] [--write]\n       pcbjs shot [entry...] [-o <dir>] [--view 2d|3d|sch...] [--camera <preset>] [--frame <ref>] [--highlight <ref>...] [--select <ref>...] [--layer <name>...] [--side F|B] [--mirror] [--explode <0..1>] [--findings [id]...] [--size WxH]\n       pcbjs diff <ref> [entry...] [-o <dir>] [--view 2d|sch] [--layer <name>...] [--side F|B]\n       pcbjs import footprint <Lib:Name|file.kicad_mod> [-o lib/<name>.tsx] [--force]\n       pcbjs import board <file.kicad_pcb> [-o pcb.tsx] [--force]\n       pcbjs docs [topic] [--grep <word|regex>]\n       pcbjs ide <install|status>\n       pcbjs skills <install [--to <dir>] [--no-claude] [--no-hooks] [--mcp <harness,...>]|list|path>\n       pcbjs mcp\n       pcbjs lsp --stdio [--agent]\n       pcbjs doctor [--desync]\n       pcbjs cache clear [folder...] [--models] [--force]\n       pcbjs create <dir>\n\n  The entries are `entries` in pcb.config.ts, paths relative to it, globs allowed; entries on the command line win for that run.\n  Each entry is a .tsx or .ts module that default-exports <PCB>. Several entries make a multi-board site.\n  The current directory is the project root. The config is pcb.config.ts, .mts, .js or .mjs in it.',
)

cli
  .command(
    'dev [...entries]',
    'start or attach to the session, which compiles the boards, updates the viewer on every change and serves fab files on demand, and follow its log; Ctrl-C detaches, twice within 2 s stops it; --workspace serves every project under the folders',
  )
  .option('--workspace', 'the arguments are folders: serve every directory with a pcb.config.* under them, the working directory without any; each loads on first use')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-p, --port <port>', 'port of a new session (default 5173)')
  .option('--host [host]', 'a new session listens on all addresses or the given one')
  .option('--open', 'open the browser')
  .option('--edit <mode>', 'who may edit through a new session: localhost, all or none (default session.edit in the config, else localhost)')
  .option('--grace <s>', 'seconds a new session stays up without clients (default 600)')
  .option('--ui-src [path]', 'a new session serves @pcbjs/ui from the source of a pcbjs checkout, the installed package or the folder given, with hot reload of its components')
  .option('--verbose', 'keep the stack of a compile error')
  .action(async (entries: string[], o) => {
    if (o.workspace && o.config) usageError('--config names one project; with --workspace each project uses its own pcb.config.*')
    warnVersionSkew()
    process.exitCode = await devCommand({ args: entries.map(String), workspace: !!o.workspace, config: o.config, ...startFlags(o), open: !!o.open })
  })

cli
  .command(
    'session <action> [...args]',
    '`session serve [entry...]` runs the session in the foreground, as CI and workers do, `--workspace` making the arguments folders; `session stop [folder]` ends it, `session status [folder]` describes it, exit 3 without one',
  )
  .option('--workspace', 'serve: the arguments are folders')
  .option('-c, --config <file>', 'serve: config file of the one project')
  .option('-p, --port <port>', 'serve: port (default 5173)')
  .option('--host [host]', 'serve: listen on all addresses or the given one')
  .option('--edit <mode>', 'serve: localhost, all or none (default session.edit in the config, else localhost)')
  .option('--grace <s>', 'serve: seconds without clients before it ends (default 600)')
  .option('--ui-src [path]', 'serve: @pcbjs/ui from the source of a pcbjs checkout')
  .option('--json', 'status: print JSON')
  .option('--verbose', 'serve: keep the stack of a compile error')
  .action(async (action: string, args: string[], o) => {
    const list = args.map(String)
    if (action === 'serve') {
      if (o.workspace && o.config) usageError('--config names one project; with --workspace each project uses its own pcb.config.*')
      const flags = startFlags(o)
      const where = o.workspace
        ? { folders: list.length ? list : ['.'] }
        : { projects: [{ dir: process.cwd(), configFile: o.config ? resolve(String(o.config)) : undefined, entries: list }] }
      process.exitCode = await sessionServe({ ...where, ...flags })
      process.exit(process.exitCode)
    } else if (action === 'stop') process.exitCode = await sessionStop(list[0])
    else if (action === 'status') process.exitCode = await sessionStatus(list[0], !!o.json)
    else usageError(`unknown session action: ${action}, use serve, stop or status`)
  })

cli
  .command('build [...entries]', 'compile the boards, write the fab files and the static site; exit 1 on DRC or ERC errors')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--out-dir <dir>', 'site output (default .pcbjs/dist)')
  .option('-q, --quiet', 'print only the board lines, the findings and the total')
  .option('--verbose', "print every finding, Vite's output, the prerendered pages and the stack of a compile error")
  .option('--json <file>', 'write every board, its findings with stable ids, its fab set and pages to <file>')
  .option('--date <iso>', 'the date every fab file carries, such as 2026-01-31T12:00:00Z, so two builds of one tree are byte identical (default SOURCE_DATE_EPOCH, else now)')
  .option('--fresh [all]', 'rebuild every stage, as make -B: delete the cache index and objects, keeping the route memos unless --fresh=all')
  .option('--lib', 'build the project as a package into dist, or --out-dir: the modules of lib.exports in the config and every board, see library.md')
  .action(async (entries: string[], o) => {
    if (o.lib) {
      if (entries.length) usageError('build --lib builds every entry of the config; it takes no entries')
      const { buildLib } = await import('./lib-build.js')
      await buildLib({ config: o.config, outDir: o.outDir, quiet: !!o.quiet })
      return
    }
    const fresh = freshOf(o.fresh, entries)
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
      fresh,
    })
  })

cli
  .command('check [...entries]', 'compile and run DRC and ERC only: no fab files, no site; exit 1 on errors')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-w, --watch', 'recompile on every change and print what is new, fixed and unchanged')
  .option('--verbose', "print every finding, unfolded and uncapped, Vite's output and the stack of a compile error")
  .option('--json <file>', 'write every board and its findings with stable ids to <file>')
  .option('--fab', 'also write the fab set in memory and read its copper and outline Gerbers back, as build does: a difference is a fab-mismatch error')
  .option('--fresh [all]', 'rebuild every stage, as make -B: delete the cache index and objects, keeping the route memos unless --fresh=all')
  .option('--cache', 'print each stage of every board as a cache hit or miss, with the first 12 hex of its key')
  .option('--test', 'run the board tests after the checks, as pcbjs test does; exit 1 when either fails')
  .action(async (entries: string[], o) => {
    warnVersionSkew()
    const fresh = freshOf(o.fresh, entries)
    const json = jsonFile(o.json)
    if (o.test && o.watch) usageError('--test runs once; drop --watch')
    const cfg = await reportingConfig('check', json, () => resolveConfig(entries, 'build', o.config))
    if (o.fab) cfg.fabCheck = true
    // --fab and --cache read this compile's own fab set and stage keys
    const viaSession = fresh || o.fab || o.cache ? null : await sessionCheck(cfg, { entries, verbose: !!o.verbose, json, watch: !!o.watch })
    let exit = viaSession ?? (await check({ cfg, state: pluginState(cfg), watch: !!o.watch, verbose: !!o.verbose, json, fresh, cache: !!o.cache }))
    if (o.test) {
      const t = await runTests(cfg, { fresh, verbose: !!o.verbose })
      if (json) addTests(cfg.root, json, t.report)
      exit = exit || t.exit
    }
    process.exitCode = exit
  })

cli
  .command(
    'q <reference>',
    'print the record of one reference of docs/refs.md as JSON in its snapshot envelope: R1, CH2/R01/2, net:VCC, route:3, route:3/pt:2, item:<uid>, drc:<id>; exit 1 when it names nothing, 2 when it names several, listing them',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--board <name>', 'the board, needed only when the reference is on several')
  .option('-t, --target <name>', 'the target of a board with variants, by name or slug (default the first)')
  .option('--timeout <s>', 'seconds a session waits for its compile before answering from the last snapshot (default 120)')
  .option('--fresh [all]', 'compile here even when a session is live, every stage rebuilt')
  .option('--verbose', "show Vite's output and the stack of a compile error")
  .action(async (reference: string, o) => {
    const fresh = freshOf(o.fresh, [])
    process.exitCode = await q({
      reference: String(reference),
      board: str(o.board),
      target: str(o.target),
      timeout: o.timeout === undefined ? undefined : Number(o.timeout),
      config: o.config,
      fresh,
      verbose: !!o.verbose,
    })
  })

cli
  .command(
    'script [code]',
    'run TypeScript against the board API of docs/queries.md: board, boards and snapshot; the last expression is printed, a string raw, anything else as JSON; - reads stdin; exit 1 on an error, 124 on the timeout',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--board <name>', 'the board bound to board (default the first)')
  .option('-t, --target <name>', 'the target of a board with variants, by name or slug (default the first)')
  .option('--timeout <ms>', 'milliseconds the code may run (default 2000, at most 30000)')
  .option('--watch <expr>', 'evaluate the expression after each compile of the session and print it when its value changed; Ctrl-C stops')
  .option('--scope <pattern>', 'with --watch: only after compiles whose findings touch the pattern, such as CH2/* or net:VCC; repeatable')
  .option('--fresh [all]', 'compile here even when a session is live')
  .option('--verbose', "show Vite's output and the stack of a compile error")
  .action(async (code: string | undefined, o) => {
    const fresh = freshOf(o.fresh, [])
    if (o.watch === true || o.watch === '') usageError('--watch needs an expression, for example --watch "board.findings().length"')
    if (o.watch === undefined && (code === undefined || code === '')) usageError('script needs code, - for stdin, or --watch <expr>')
    process.exitCode = await script({
      code: code === undefined ? undefined : String(code),
      board: str(o.board),
      target: str(o.target),
      timeout: o.timeout === undefined ? undefined : Number(o.timeout),
      watch: o.watch === undefined ? undefined : String(o.watch),
      scope: many(o.scope),
      config: o.config,
      fresh,
      verbose: !!o.verbose,
    })
  })

cli
  .command('repl', 'an interactive script prompt; in a session the bindings persist and board follows the newest snapshot, here .refresh compiles again')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--board <name>', 'the board bound to board (default the first)')
  .option('-t, --target <name>', 'the target of a board with variants, by name or slug (default the first)')
  .option('--timeout <ms>', 'milliseconds a line may run (default 2000, at most 30000)')
  .option('--fresh [all]', 'compile here even when a session is live')
  .action(async o => {
    process.exitCode = await repl({
      board: str(o.board),
      target: str(o.target),
      timeout: o.timeout === undefined ? undefined : Number(o.timeout),
      config: o.config,
      fresh: freshOf(o.fresh, []),
    })
  })

cli
  .command(
    'events',
    "the session's events as JSON lines, then { next }: --since <cursor> those after it, --wait the first of --for kinds, --follow every one until Ctrl-C; exit 3 without a session, 124 when --wait times out",
  )
  .option('--since <cursor>', 'the next of an earlier run; without it only the next line is printed')
  .option('--wait', 'block for a matching event after the cursor or now')
  .option('--for <kinds>', 'with --wait: edit, save, compile, findings, selection, cursor, message or delivered, comma separated (default any)')
  .option('--timeout <s>', 'with --wait: seconds before exit 124 (default 600)')
  .option('--follow', 'stream every event until Ctrl-C or the session ends, ending { end }')
  .option('--scope <pattern>', 'only events that touch the pattern: CH2/*, net:VCC, route:*, drc:clearance:* or a file; repeatable')
  .option('--kind <kinds>', 'only these kinds, comma separated')
  .action(async o => {
    const kinds = (v: unknown) =>
      many(v)
        ?.flatMap(k => k.split(','))
        .filter(Boolean)
    process.exitCode = await events({
      since: str(o.since),
      wait: !!o.wait,
      for: kinds(o.for),
      timeout: o.timeout === undefined ? undefined : Number(o.timeout),
      follow: !!o.follow,
      scope: many(o.scope),
      kind: kinds(o.kind),
    })
  })

cli
  .command(
    'test [...files]',
    'run the board tests, every *.test.ts under the project, with node --test against one snapshot, and compare each golden/ folder with the fab set; exit 1 when one fails',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--update', 'write golden/<board>/ from the current fab set first')
  .option('--json <file>', 'write the results as a pcbjs.check/1 report')
  .option('--fresh [all]', 'compile here even when a session is live')
  .option('--verbose', "show Vite's output and the stack of a compile error")
  .action(async (files: string[], o) => {
    const fresh = freshOf(o.fresh, files)
    const json = jsonFile(o.json)
    const cfg = await resolveConfig([], 'build', o.config, undefined, () => {})
    const t = await runTests(cfg, { files: files.map(String), update: !!o.update, fresh, verbose: !!o.verbose })
    if (json) writeReport(cfg.root, json, testReport(cfg.root, t.report))
    process.exitCode = t.exit
  })

cli
  .command(
    'inspect [...queries]',
    'compile one board and print its frame and footprints, or each query, any reference of docs/refs.md: a part R1 or CH2/R01 with its pads, a pad R1/2, a net GND or net:GND with its pads, vias and routes, route:3/pt:2, item:<uid>, drc:<id>; --lengths prints the route table; one compile answers them all',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-t, --target <name>', 'the target of a board with variants, by name or slug (default the first)')
  .option('--json', 'print JSON instead of text')
  .option('--lengths [filter]', 'print every route with its length, target, match group, status and source, or those of one net, pair or match group; repeat it for several')
  .option(
    '--layer <name>',
    'print every item on the layer, by id or alias, with its bounds, text, ref and source: strokes and glyphs of text, drawings, tracks, pours, pads; a query filters it by part or net; repeatable',
  )
  .option('--references', 'print each reference() of the board: entry, anchor, stack, gap, frame and mesh')
  .option('--sch', 'print the schematic drawing: symbols, wires, labels, sheets')
  .option('--grids', 'print each grid of the board: pitch, subdivisions, origin, angle, frame and what is placed on it')
  .option('--fresh [all]', 'compile here even when a running dev server holds a current board, every stage rebuilt as check --fresh does')
  .option('--verbose', "show Vite's output and the stack of a compile error")
  .action(async (args: string[], o) => {
    const fresh = freshOf(o.fresh, args)
    const layers: string[] = (o.layer === undefined ? [] : Array.isArray(o.layer) ? o.layer : [o.layer]).map(String)
    if (layers.some(l => l === 'true' || l === '')) usageError('--layer needs a layer, for example --layer F.SilkS')
    const reports = [...(o.references ? (['references'] as const) : []), ...(o.sch ? (['sch'] as const) : []), ...(o.grids ? (['grids'] as const) : [])]
    const { entry, requests } = inspectRequests(args.map(String), o.lengths, layers, reports)
    process.exitCode = await inspect({ entry, requests, config: o.config, json: !!o.json, target: o.target, verbose: !!o.verbose, fresh })
  })

cli
  .command(
    'shot [...entries]',
    'PNGs of the render spec of render.md, by the renderer and sharp, no browser: one per board, target, view and --select, to .pcbjs/shots/<board>-<view>[-<options>].png',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-o, --out <dir>', 'output directory (default .pcbjs/shots)')
  .option('--view <view>', '2d, 3d or sch; repeat it for several (default 2d and 3d)')
  .option('--camera <camera>', 'the 3D camera: iso, top, bottom, front, or a renderer camera as JSON (default iso)')
  .option('--frame <ref>', 'frame a reference, finding id, net, group path or a box x0,y0,x1,y1 in board mm')
  .option('--margin <mm>', 'around the framed box (default 1)')
  .option('--highlight <ref>', 'outline and tint a reference, the rest faded; repeat it for several')
  .option('--dim <amount>', 'how far the rest fades with a highlight, 0 to 1 (default 0.6)')
  .option('--select <ref>', 'frame and highlight one reference; repeat it for one shot each')
  .option('--layer <name>', 'show only these layers or groups, the outline kept in 2D: an id, an alias, copper, silk, mask, bodies, board; repeat it for several')
  .option('--opacity <group=amount>', 'a layer or group at 0 to 1, as F.Mask=0.3 or bodies=0.5; repeat it for several')
  .option('--side <side>', 'F or B: the side on top in 2D, unmirrored; B turns the 3D board over (default F)')
  .option('--mirror', 'mirror the view left to right')
  .option('--explode <amount>', 'the exploded 3D stack, 0 to 1 of the full separation')
  .option('--findings [id]', 'ring findings: every error and warning, or the ids and rule names given; repeat it for several')
  .option('--mark <json>', 'a mark as JSON, {"type":"ring","at":[x,y],"layer":"F.Cu"}, see render.md; repeat it for several')
  .option('--theme <theme>', 'light, dark or hc (default light)')
  .option('--size <WxH>', 'image size in pixels (default 1280x960)')
  .option('--quality <n>', 'supersampling of the 3D view, 1 to 4 (default 1)')
  .option('--fresh [all]', 'compile here even when a session is live, every stage rebuilt as check --fresh does')
  .option('--verbose', "show Vite's output")
  .action(async (entries: string[], o) => {
    const fresh = freshOf(o.fresh, entries)
    const many = (v: unknown): string[] => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map(String))
    for (const k of ['out', 'layer', 'select', 'highlight', 'frame', 'opacity', 'mark'] as const)
      if (many(o[k]).some(v => v === 'true' || v === '')) usageError(`--${k} needs a value`)
    for (const k of ['out', 'frame', 'camera', 'margin', 'dim', 'side', 'explode', 'theme', 'size', 'quality'] as const) if (Array.isArray(o[k])) usageError(`give --${k} once`)
    const views = many(o.view).map(v => v.toLowerCase())
    for (const v of views) if (!SHOT_VIEWS.includes(v as ShotView)) usageError(`bad --view: ${v}, use 2d, 3d or sch, repeated for several`)
    const size = o.size === undefined ? undefined : parseSize(String(o.size))
    if (size === null) usageError(`bad --size: ${o.size}, use WxH such as 1280x960, each from 16 to 4096`)
    const json = (flag: string, v: string) => {
      try {
        return JSON.parse(v)
      } catch {
        return usageError(`bad --${flag}: ${v} is not JSON`)
      }
    }
    const camera = o.camera === undefined ? undefined : String(o.camera).trim().startsWith('{') ? json('camera', String(o.camera)) : String(o.camera).toLowerCase()
    const opacity = many(o.opacity).map(v => /^(.+)=([\d.]+)$/.exec(v) ?? usageError(`bad --opacity: ${v}, use group=amount such as F.Mask=0.3`))
    const findings = o.findings === undefined ? undefined : many(o.findings).map(v => (v === 'true' ? 'all' : v))
    let look: Look
    try {
      const { view: _, ...rest } = parseSpec({
        view: '3d',
        camera,
        frame: o.frame,
        margin: o.margin,
        highlight: o.highlight === undefined ? undefined : many(o.highlight),
        dim: o.dim,
        layers: o.layer === undefined ? undefined : many(o.layer),
        opacity: opacity.length ? Object.fromEntries(opacity.map(m => [m[1], Number(m[2])])) : undefined,
        side: o.side === undefined ? undefined : String(o.side).toUpperCase(),
        mirror: o.mirror || undefined,
        explode: o.explode,
        findings,
        marks: o.mark === undefined ? undefined : many(o.mark).map(m => json('mark', m)),
        theme: o.theme === undefined ? undefined : String(o.theme).toLowerCase(),
        size,
        quality: o.quality,
      })
      look = rest
    } catch (e) {
      usageError(`bad shot option: ${(e as Error).message.replace(/^render: /, '')}`)
    }
    process.exitCode = await shot({ entries, config: o.config, outDir: o.out, views: views as ShotView[], look, select: many(o.select), verbose: !!o.verbose, fresh })
  })

cli
  .command(
    'diff <ref> [...entries]',
    'each board against the same entry at a git ref, compiled in a worktree outside the project: before.png, after.png, diff.png with removed copper red, added green and moved amber, and diff.json, to .pcbjs/diff/<board>[~<target>]/; exit 1 when a tree fails to compile',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('-o, --out <dir>', 'output directory (default .pcbjs/diff)')
  .option('--view <view>', '2d or sch, the schematic compared by pixels (default 2d)')
  .option('--layer <name>', 'show and compare only these layers or groups, as shot does; repeat it for several')
  .option('--side <side>', 'F or B, the side on top (default F)')
  .action(async (ref: string, entries: string[], o) => {
    const many = (v: unknown): string[] => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map(String))
    const view = o.view === undefined ? '2d' : String(o.view).toLowerCase()
    if (view !== '2d' && view !== 'sch') usageError(`bad --view: ${o.view}, use 2d or sch`)
    const side = o.side === undefined ? undefined : String(o.side).toUpperCase()
    if (side !== undefined && side !== 'F' && side !== 'B') usageError(`bad --side: ${o.side}, use F or B`)
    if (many(o.layer).some(v => v === 'true' || v === '')) usageError('--layer needs a value')
    process.exitCode = await diff({ ref: String(ref), entries, config: o.config, outDir: o.out, view, layers: many(o.layer), side: side as 'F' | 'B' | undefined })
  })

cli
  .command(
    'model <action> [...args]',
    "model files: `add <file-or-url|lcsc:C123>` copies or downloads one into models/ and fits it with --ref, and with --ref alone fetches the part's MPN:LCSC model; `align <ref>` prints the transform that puts a model on its pads; `check [entry...]` lists every model and flags missing, unread and misplaced ones; `fetch [entry...]` downloads the models the parts name, KiCad library, LCSC or URL, into .pcbjs/models/fetched; `cache ls|prune|path` lists, prunes or locates the user-level model cache",
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--ref <ref>', 'add: fit the model to this placed part and print its model option')
  .option('--entry <entry>', 'add, align: the board the ref is on, by entry file, board name or folder; needed when the ref is on several boards')
  .option('--footprint <name>', 'add: fit the model to the first part with this footprint id, such as RJ45_JK0654219NL, and write it on the <footprint> element')
  .option('--as <name>', 'add: the file name in models/, the extension added when missing')
  .option('--write', 'add: write the model option into the code, the path relative to the file it is written in')
  .option('--force', 'add: replace a file of the same name with other content')
  .option('--file <model>', 'align: fit this file instead of the one the part uses')
  .option('--older <days>', 'cache prune: remove what was not used for this many days')
  .option('--max-size <MB>', 'cache prune: remove the least recently used until the cache is at most this size')
  .option('--all', 'cache prune: remove everything')
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
      if (args.length !== 1) usageError('model align takes one ref, and --entry when the ref is on several boards: pcbjs model align <ref> [--entry <board>]')
      process.exitCode = await modelAlign({ entry: str(o.entry), ref: String(args[0]), file: str(o.file), ...common })
    } else if (action === 'check') process.exitCode = await modelCheck({ entries: args.map(String), ...common })
    else if (action === 'fetch') process.exitCode = await modelFetch({ entries: args.map(String), ...common })
    else if (action === 'cache') {
      const sub = String(args[0] ?? '')
      if (args.length !== 1 || !['ls', 'prune', 'path'].includes(sub))
        usageError('model cache takes ls, prune or path: pcbjs model cache prune [--older <days>] [--max-size <MB>] [--all]')
      const count = (k: 'older' | 'maxSize', flag: string) => {
        if (o[k] === undefined) return undefined
        const v = Number(o[k])
        if (o[k] === true || !Number.isFinite(v) || v < 0) usageError(`--${flag} needs a number of ${k === 'older' ? 'days' : 'MB'}`)
        return v
      }
      const older = count('older', 'older'),
        maxSize = count('maxSize', 'max-size')
      if (sub === 'prune' && older === undefined && maxSize === undefined && !o.all) usageError('model cache prune needs --older <days>, --max-size <MB> or --all')
      process.exitCode = modelCache(sub, { older, maxSize, all: !!o.all })
    } else usageError(`unknown model action: ${action}, use add, align, check, fetch or cache`)
  })

cli
  .command('patch <op> <ref>', "write a patch into the .patches.ts file beside the entry; `hold <route>` freezes the route's automatic legs as this compile leaves them")
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--entry <entry>', 'the board, by entry file; needed when the config lists several')
  .option('--target <name>', 'the variant target to take the copper from (default the first)')
  .option('--verbose', "show Vite's output and the stack of a compile error")
  .action(async (op: string, ref: string, o) => {
    if (op !== 'hold') usageError(`patch writes hold, pcbjs patch hold <route>; got ${op}`)
    if (o.entry === true || o.entry === '') usageError('--entry needs a value')
    process.exitCode = await patchHold({ ref: String(ref), entry: o.entry, config: o.config, target: o.target, verbose: !!o.verbose })
  })

cli
  .command('place [...entries]', 'print where the placer, the solvers and the follower pass put each part with an auto slot in its at; --write freezes them into the source')
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--write', "write each placement into its part's at and drop its at:initial, at:cost, at:solver and at:follow")
  .option('--verbose', "show Vite's output and the stack of a compile error")
  .action(async (entries: string[], o) => {
    process.exitCode = await placeCommand({ entries, config: o.config, write: !!o.write, verbose: !!o.verbose })
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
  .option('--no-hooks', 'install: write the Claude Code plugin without its prompt and edit hooks')
  .option('--mcp <harnesses>', 'install: also register pcbjs mcp for these, comma separated: claude, vscode, cursor, codex (default those whose folder exists, and claude)')
  .action(async (action: string, o) => {
    if ((o.to !== undefined || o.claude === false || o.hooks === false || o.mcp !== undefined) && action !== 'install')
      usageError('--to, --no-claude, --no-hooks and --mcp go with skills install')
    const harnesses = o.mcp === undefined ? undefined : String(o.mcp).split(',').filter(Boolean)
    const bad = harnesses?.filter(h => !HARNESSES.includes(h as Harness)) ?? []
    if (bad.length) usageError(`--mcp takes ${HARNESSES.join(', ')}; not ${bad.join(', ')}`)
    process.exitCode = await skills(action, {
      to: o.to === undefined ? undefined : String(o.to),
      claude: o.claude !== false,
      hooks: o.hooks !== false,
      mcp: harnesses as Harness[] | undefined,
    })
  })

cli
  .command(
    'mcp',
    'an MCP server on stdio for coding agents, a client of the session it starts when none is live: check, inspect, query, render, script, docs, read, write, events, session',
  )
  .action(async () => {
    process.exitCode = await mcp()
  })

cli
  .command('lsp', 'the language server on stdio for any editor, a client of the session it starts when none is live; docs/lsp.md has the editor setups')
  .option('--stdio', 'speak LSP on stdin and stdout, the one transport')
  .option('--agent', 'the client is a coding agent: it syncs a file only while no editor holds it')
  .action(async o => {
    if (!o.stdio) usageError('pcbjs lsp needs --stdio')
    process.exitCode = await lspStdio({ role: o.agent ? 'agent' : 'editor' })
  })

cli
  .command(
    'hook <action>',
    'the agent hooks of pcbjs skills install: `hook prompt` prints the events since the last turn and the messages waiting, `hook edited` claims a write of the harness; the hook JSON on stdin',
  )
  .option('--name <harness>', 'the harness the hook speaks for, as its MCP initialize names it (default claude-code)')
  .action(async (action: string, o) => {
    process.exitCode = await hook(action, { name: o.name === undefined ? undefined : String(o.name) })
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
    'cache <action> [...folders]',
    '`cache clear [folder...]` deletes .pcbjs/cache and .pcbjs/typecheck.json of every project under the folders, the working directory without any; refuses while a live session serves one',
  )
  .option('--models', 'clear: also delete .pcbjs/models, the model and board meshes and the fetched models')
  .option('--force', 'clear: delete even while a live session serves a project')
  .action(async (action: string, folders: string[], o) => {
    if (action !== 'clear') usageError(`unknown cache action: ${action}, use clear`)
    const { cacheClear } = await import('./cache-clear.js')
    process.exitCode = await cacheClear({ folders: folders.map(String), models: !!o.models, force: !!o.force })
  })

cli
  .command(
    'doctor',
    'print the installed @pcbjs versions, Node, the renderer, the step converter, the file format versions and the config; exit 1 when the packages disagree on major.minor',
  )
  .option('-c, --config <file>', 'config file (default: pcb.config.ts, .mts, .js or .mjs)')
  .option('--desync', 'print the last incident of a view out of sync with the session, from .pcbjs/log/')
  .action(async o => {
    process.exitCode = await doctor({ config: o.config, desync: !!o.desync })
  })

cli
  .command('create [dir]', 'start a new project in <dir> from the board template or an example: a board in pcb.tsx, pcb.config.ts listing it, package.json and tsconfig.json')
  .option('--example <name>', 'copy an example board instead of the template; --list-examples names them')
  .option('--list-examples', 'print the example boards with a line on each')
  .option('--layers <n>', 'copper layers, 2, 4, 6 or 8 (default 2)')
  .option('--fab <preset>', 'fab preset such as JLCPCB/4-Layer (default JLCPCB/<layers>-Layer)')
  .option('--size <WxH>', 'board size in mm, or the diameter of a circle (default 20x15, a circle 40)')
  .option('--outline <shape>', 'rect, rounded, rounded:<radius mm> or circle (default rounded, 1 mm corners)')
  .action((dir: string | undefined, o) => {
    const { example, listExamples, layers, fab, size, outline } = o
    createCommand(dir, { example, listExamples, layers, fab, size, outline })
  })

cli.help(sections => [{ body: versionLine() }, ...sections.slice(1)])
cli.version(cliVersion())
cli.outputVersion = () => console.log(versionLine())

/** The flags that shape a new session. */
function startFlags(o: any): { port?: number; host?: string | boolean; edit?: EditMode; grace?: number; verbose: boolean; uiSrc?: string } {
  if (o.edit !== undefined && !EDIT_MODES.includes(o.edit)) usageError(`bad --edit: ${o.edit}, use localhost, all or none`)
  const grace = o.grace === undefined ? undefined : Number(o.grace)
  if (grace !== undefined && !(grace >= 0)) usageError(`bad --grace: ${o.grace}, use seconds such as 600`)
  let uiSrc: string | undefined
  try {
    uiSrc = o.uiSrc === undefined ? undefined : uiSource(o.uiSrc === true || o.uiSrc === '' ? null : String(o.uiSrc))
  } catch (e) {
    usageError((e as Error).message)
  }
  return { port: portOf(o.port), host: o.host, edit: o.edit, grace, verbose: !!o.verbose, ...(uiSrc ? { uiSrc } : {}) }
}

const str = (v: unknown): string | undefined => (v === undefined || v === true || v === '' ? undefined : String(v))
const many = (v: unknown): string[] | undefined => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]).map(String))

/** 0 asks the system for a free port */
function portOf(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '' || v === true) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 65535) usageError(`bad port: ${v}`)
  return n
}

/** The config, or on its error a `pcbjs.check/1` report of it in the --json file before the error goes on. */
async function reportingConfig<T>(command: 'check' | 'build', json: string | undefined, load: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  try {
    return await load()
  } catch (e) {
    if (json) writeReport(process.cwd(), json, failedReport(command, process.cwd(), e, performance.now() - t0))
    throw e
  }
}

/** a bare --json would read the next entry as its file */
/** `--fresh`: true, or 'all' to drop the route memos too; cac reads the word after a bare --fresh as its value, so any other word goes back to the arguments. */
function freshOf(v: unknown, args: string[]): false | true | 'all' {
  if (v === undefined || v === false) return false
  if (v === 'all') return 'all'
  if (typeof v === 'string' && v) args.unshift(v)
  return true
}

function jsonFile(v: unknown): string | undefined {
  if (v === undefined || v === false) return undefined
  if (v === true || v === '') usageError('--json needs a file, for example --json .pcbjs/report.json')
  return String(v)
}

/** The first argument is the entry when it names a module; a bare `--lengths` makes each query a filter, or adds the whole table; `--references` and `--sch` add their reports. */
export function inspectRequests(
  args: string[],
  lengths: unknown,
  layers: string[] = [],
  reports: readonly NonNullable<InspectRequest['report']>[] = [],
): { entry?: string; requests: InspectRequest[] } {
  const entry = args.length && looksLikeEntry(args[0]) ? args[0] : undefined
  const queries = entry === undefined ? args : args.slice(1)
  const extra: InspectRequest[] = reports.map(report => ({ report }))
  // --layer filters by each query; --lengths beside it adds its route tables
  if (layers.length) {
    const lengthFlags = (Array.isArray(lengths) ? lengths : [lengths]).filter(v => v !== undefined && v !== false)
    const tables = lengthFlags.map(v => (typeof v === 'string' && v !== '' ? { query: v, lengths: true } : { lengths: true }))
    return { entry, requests: [...layers.flatMap(layer => (queries.length ? queries.map(q => ({ query: q, layer })) : [{ layer }])), ...tables, ...extra] }
  }
  const flags = (Array.isArray(lengths) ? lengths : [lengths]).filter(v => v !== undefined && v !== false)
  const filters = flags.filter(v => typeof v === 'string' || typeof v === 'number').map(String)
  const bare = flags.some(v => v === true || v === '')
  if (bare && !filters.length) return { entry, requests: [...(queries.length ? queries.map(q => ({ query: q, lengths: true })) : [{ lengths: true }]), ...extra] }
  const requests: InspectRequest[] = [...queries.map(q => ({ query: q })), ...filters.map(q => ({ query: q, lengths: true })), ...(bare ? [{ lengths: true }] : []), ...extra]
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
