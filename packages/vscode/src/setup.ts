// The commands that start a project: create one, convert a KiCad project and install the agent skills, each through a pcbjs CLI.

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { spawn as nodeSpawn } from 'node:child_process';
import { findBinary, findGlobal, launcher, type SpawnFn } from './server';

export interface SetupHost {
  output(line: string): void;
  showOutput(): void;
  nodePath(): string;
  /** the folders of every pcb.config found in the workspace */
  projectDirs(): string[];
  /** the project is on disk: show its board file and its preview */
  opened(dir: string, file: string): Promise<void>;
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
}

export interface Runner {
  command: string;
  args: string[];
  shell: boolean;
}

export interface RunResult {
  code: number | null;
  lines: string[];
}

export interface KicadProject {
  pro: string;
  pcb: string;
  name: string;
  /** why it cannot be converted */
  skip?: string;
}

export const KICAD_GLOB = '**/*.kicad_pro';
export const KICAD_EXCLUDE = '{**/node_modules/**,**/.pcbjs/**}';
export const SKILLS_NPX = 'npx @pcbjs/skills install';

const win = process.platform === 'win32';

/** npm or npx beside the node that runs pcbjs, else from PATH. */
export function nodeTool(node: string, tool: 'npm' | 'npx', args: string[], exists: (p: string) => boolean = fs.existsSync): Runner {
  const name = win ? `${tool}.cmd` : tool;
  const beside = path.join(path.dirname(node), name);
  return { command: path.isAbsolute(node) && exists(beside) ? beside : name, args, shell: win };
}

/** The pcbjs installed in the first of the dirs or above it, else a global one, else the latest from npm through npx. */
export function pcbjsRunner(dirs: string[], node: string, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = fs.existsSync): Runner {
  for (const d of dirs) {
    const bin = findBinary(d, exists);
    if (bin) return launcher(bin, node);
  }
  const global = findGlobal(env, exists);
  if (global) return launcher(global, node);
  return nodeTool(node, 'npx', ['--yes', '--package', '@pcbjs/pcbjs', 'pcbjs'], exists);
}

export function kicadProject(pro: string, exists: (p: string) => boolean = fs.existsSync): KicadProject {
  const name = path.basename(pro, '.kicad_pro');
  const pcb = path.join(path.dirname(pro), `${name}.kicad_pcb`);
  return exists(pcb) ? { pro, pcb, name } : { pro, pcb, name, skip: `no ${name}.kicad_pcb beside it` };
}

/** Sorted by path, the convertible ones first. */
export function kicadProjects(pros: string[], exists: (p: string) => boolean = fs.existsSync): KicadProject[] {
  return pros
    .map((p) => kicadProject(p, exists))
    .sort((a, b) => Number(!!a.skip) - Number(!!b.skip) || a.pro.localeCompare(b.pro));
}

/** `<name>-pcbjs` beside the KiCad project's folder, or inside it when that folder is a workspace root. */
export function importDest(p: KicadProject, roots: string[]): string {
  const dir = path.dirname(p.pro);
  const up = path.dirname(dir);
  const inside = up === dir || roots.some((r) => path.resolve(r) === path.resolve(dir));
  return path.join(inside ? dir : up, `${p.name}-pcbjs`);
}

/** `.` for an empty folder, else the first free of board, board-2, board-3. */
export function defaultProjectDir(parent: string): string {
  if (!fs.existsSync(parent) || !fs.readdirSync(parent).length) return '.';
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'board' : `board-${n}`;
    if (!fs.existsSync(path.join(parent, name))) return name;
  }
}

/** What `pcbjs create` would refuse, as an input box message. */
export function projectDirError(parent: string, value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Give a folder name, or . for the folder itself';
  const dir = path.resolve(parent, v);
  if (!fs.existsSync(dir)) return undefined;
  if (!fs.statSync(dir).isDirectory()) return `${v} is a file`;
  if (fs.readdirSync(dir).length) return `${v} is not empty; give a new or empty folder`;
  return undefined;
}

export function destError(base: string, value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Give a folder';
  const dir = path.resolve(base, v);
  if (!fs.existsSync(dir)) return undefined;
  if (!fs.statSync(dir).isDirectory()) return `${v} is a file`;
  if (fs.existsSync(path.join(dir, 'pcb.tsx'))) return `${v} already holds a pcb.tsx`;
  return undefined;
}

/** @pcbjs/skills from the project, or from the pcbjs it runs, as `pcbjs skills` loads it. */
export function resolvesSkills(root: string, bin: string | undefined): boolean {
  const froms = [path.join(root, 'package.json')];
  if (bin) {
    try {
      froms.push(fs.realpathSync(bin));
    } catch {}
  }
  return froms.some((from) => {
    try {
      createRequire(from).resolve('@pcbjs/skills/package.json');
      return true;
    } catch {
      return false;
    }
  });
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

const defaultSpawn: SpawnFn = (command, args, options) => nodeSpawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

/** Runs to the end, every line to the output channel and to onLine. */
export function run(r: Runner, args: string[], cwd: string, h: SetupHost, onLine: (line: string) => void = () => undefined): Promise<RunResult> {
  const all = [...r.args, ...args];
  const lines: string[] = [];
  const push = (line: string) => {
    lines.push(line);
    h.output(line);
    onLine(line);
  };
  h.output(`$ ${[r.command, ...all].join(' ')}  (in ${cwd})`);
  const env: NodeJS.ProcessEnv = { ...(h.env ?? process.env), NO_COLOR: '1' };
  const node = h.nodePath();
  // npx and npm scripts find node through PATH
  if (path.isAbsolute(node)) env.PATH = [path.dirname(node), env.PATH].filter(Boolean).join(path.delimiter);
  return new Promise((done) => {
    let child;
    try {
      child = (h.spawn ?? defaultSpawn)(r.command, all, { cwd, env, ...(r.shell ? { shell: true } : {}) });
    } catch (err) {
      push(`cannot run ${r.command}: ${(err as Error).message}`);
      return done({ code: null, lines });
    }
    const streams = [child.stdout, child.stderr].filter((s): s is NodeJS.ReadableStream => !!s);
    let open = streams.length;
    let code: number | null | undefined;
    const finish = () => {
      if (open === 0 && code !== undefined) done({ code, lines });
    };
    for (const s of streams) {
      let rest = '';
      s.on('data', (chunk: Buffer | string) => {
        const parts = (rest + chunk.toString()).split(/\r?\n/);
        rest = parts.pop() ?? '';
        for (const l of parts) push(l.replace(ANSI, ''));
      });
      s.on('end', () => {
        if (rest) push(rest.replace(ANSI, ''));
        open--;
        finish();
      });
    }
    child.on('error', (err) => {
      push(`cannot run ${r.command}: ${err.message}`);
      open = 0;
      code = null;
      finish();
    });
    child.on('exit', (c) => {
      code = c;
      finish();
    });
  });
}

/** One run under a progress notification; on failure an error with its last line. */
async function step(title: string, r: Runner, args: string[], cwd: string, h: SetupHost): Promise<RunResult | undefined> {
  const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `pcbjs: ${title}` }, (p) => run(r, args, cwd, h, (line) => line.trim() && p.report({ message: line.trim() })));
  if (res.code === 0) return res;
  const last = res.lines.filter((l) => l.trim()).at(-1) ?? `exit code ${res.code}`;
  void vscode.window.showErrorMessage(`pcbjs: ${title} failed: ${last}`, 'Show output').then((a) => a && h.showOutput());
  return undefined;
}

/** npm install when no pcbjs resolves from the new project, so its dev server can start. */
async function ensureInstalled(dir: string, h: SetupHost): Promise<boolean> {
  if (findBinary(dir)) return true;
  return !!(await step(`installing the packages of ${path.basename(dir)}`, nodeTool(h.nodePath(), 'npm', ['install']), [], dir, h));
}

const roots = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
const rel = (p: string) => vscode.workspace.asRelativePath(p, roots().length > 1);

/** The only workspace folder, a pick of several, or an open dialog without one. */
async function pickFolder(placeHolder: string, openLabel: string): Promise<string | undefined> {
  const all = roots();
  if (all.length === 1) return all[0];
  if (all.length) {
    const c = await vscode.window.showQuickPick(all.map((dir) => ({ label: path.basename(dir), description: dir, dir })), { placeHolder });
    return c?.dir;
  }
  const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel });
  return picked?.[0]?.fsPath;
}

/** A quick pick with one item active, so a single choice still asks to confirm. */
function pickOne<T extends vscode.QuickPickItem>(items: T[], placeholder: string, active: T | undefined): Promise<T | undefined> {
  const qp = vscode.window.createQuickPick<T>();
  qp.items = items;
  qp.placeholder = placeholder;
  if (active) qp.activeItems = [active];
  return new Promise((done) => {
    qp.onDidAccept(() => {
      done(qp.selectedItems[0] ?? qp.activeItems[0]);
      qp.hide();
    });
    qp.onDidHide(() => {
      done(undefined);
      qp.dispose();
    });
    qp.show();
  });
}

export async function createProject(h: SetupHost): Promise<string | undefined> {
  const parent = await pickFolder('Create the pcbjs project in which folder?', 'Create here');
  if (!parent) return undefined;
  const name = await vscode.window.showInputBox({
    title: 'pcbjs: Create project in workspace',
    prompt: `The project folder, relative to ${parent}; . for that folder itself when it is empty. Its name is the board's name.`,
    value: defaultProjectDir(parent),
    validateInput: (v) => projectDirError(parent, v),
  });
  if (name === undefined) return undefined;
  const dir = path.resolve(parent, name.trim());
  const pcbjs = pcbjsRunner([parent, ...roots()], h.nodePath(), h.env);
  if (!(await step(`creating ${path.basename(dir)}`, pcbjs, ['create', name.trim()], parent, h))) return undefined;
  if (!(await ensureInstalled(dir, h))) return undefined;
  await h.opened(dir, path.join(dir, 'pcb.tsx'));
  return dir;
}

async function pickKicad(): Promise<KicadProject | undefined> {
  const found = kicadProjects((await vscode.workspace.findFiles(KICAD_GLOB, KICAD_EXCLUDE)).map((u) => u.fsPath));
  let p: KicadProject | undefined;
  if (!found.length) {
    const picked = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: 'Convert', filters: { 'KiCad project': ['kicad_pro'] } });
    p = picked?.[0] && kicadProject(picked[0].fsPath);
  } else {
    type Item = vscode.QuickPickItem & { project: KicadProject };
    const items: Item[] = found.map((project) => ({
      label: `${project.skip ? '$(circle-slash)' : '$(circuit-board)'} ${rel(project.pro)}`,
      detail: project.skip ? `skipped: ${project.skip}` : rel(project.pcb),
      project,
    }));
    const placeholder = found.length === 1 ? 'Convert this KiCad project?' : 'Convert which KiCad project?';
    p = (await pickOne(items, placeholder, items.find((i) => !i.project.skip)))?.project;
  }
  if (p?.skip) {
    void vscode.window.showWarningMessage(`pcbjs: ${rel(p.pro)} is skipped: ${p.skip}. pcbjs import board reads the .kicad_pcb of the project's name.`);
    return undefined;
  }
  return p;
}

export async function convertKicad(h: SetupHost): Promise<string | undefined> {
  const p = await pickKicad();
  if (!p) return undefined;
  const base = path.dirname(p.pro);
  const answer = await vscode.window.showInputBox({
    title: `pcbjs: Convert ${p.name} from KiCad`,
    prompt: `The folder of the new pcbjs project, created when missing; relative paths from ${base}`,
    value: importDest(p, roots()),
    validateInput: (v) => destError(base, v),
  });
  if (answer === undefined) return undefined;
  const dest = path.resolve(base, answer.trim());
  fs.mkdirSync(dest, { recursive: true });
  const pcbjs = pcbjsRunner([dest, base, ...roots()], h.nodePath(), h.env);
  if (!(await step(`converting ${p.name}`, pcbjs, ['import', 'board', p.pcb, '-o', 'pcb.tsx'], dest, h))) return undefined;
  if (!(await ensureInstalled(dest, h))) return undefined;
  await h.opened(dest, path.join(dest, 'pcb.tsx'));
  void vscode.window.showInformationMessage(`pcbjs: converted ${p.name} into ${rel(dest)}. The output lists what the import could not carry.`, 'Show output').then((a) => a && h.showOutput());
  return dest;
}

/** The only project, a pick of several, else a workspace folder. */
async function pickProject(dirs: string[]): Promise<string | undefined> {
  if (dirs.length === 1) return dirs[0];
  if (!dirs.length) return pickFolder('Install the skills in which folder?', 'Install here');
  const c = await vscode.window.showQuickPick(dirs.map((dir) => ({ label: path.basename(dir), description: rel(dir), dir })), { placeHolder: 'Install the skills in which pcbjs project?' });
  return c?.dir;
}

export async function installSkills(h: SetupHost): Promise<RunResult | undefined> {
  const root = await pickProject(h.projectDirs());
  if (!root) return undefined;
  const bin = findBinary(root);
  const title = `installing the agent skills in ${path.basename(root)}`;
  let res: RunResult | undefined;
  if (bin && resolvesSkills(root, bin)) res = await step(title, launcher(bin, h.nodePath()), ['skills', 'install'], root, h);
  else {
    const missing = bin ? '@pcbjs/skills does not resolve' : 'pcbjs is not installed';
    const a = await vscode.window.showWarningMessage(`pcbjs: in ${rel(root)} ${missing}, so pcbjs skills install cannot run. \`${SKILLS_NPX}\` copies the skills from npm instead.`, 'Run npx', 'Copy command');
    if (a === 'Copy command') void vscode.env.clipboard.writeText(SKILLS_NPX);
    if (a !== 'Run npx') return undefined;
    res = await step(title, nodeTool(h.nodePath(), 'npx', ['--yes', '@pcbjs/skills', 'install']), [], root, h);
  }
  if (!res) return undefined;
  const lines = res.lines.filter((l) => l.trim());
  void vscode.window.showInformationMessage(`pcbjs: skills in ${rel(root)}: ${lines.join('; ') || 'none'}`, 'Show output').then((a) => a && h.showOutput());
  return res;
}
