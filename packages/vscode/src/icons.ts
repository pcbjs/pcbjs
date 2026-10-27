
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONFIG_NAMES,
  Found,
  configEntries,
  fixedAssociations,
  foundAssociations,
  iconTheme,
  isGlob,
  materialSettings,
  mergeAssociations,
  vsiconsSettings,
  type Icon,
  type IconTheme,
} from './icon-map';
import { MATERIAL, PCBJS_THEME, VSICONS, type IconEnv } from './auto-icons';

const IGNORE = '**/{node_modules,.pcbjs,dist}/**';
/** files read for `defineFootprint` per project */
const SCAN_LIMIT = 400;

const activeTheme = () => vscode.workspace.getConfiguration('workbench').get<string>('iconTheme');

/** The files in `entries` of each project's config, globs expanded. */
export async function findEntries(dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const dir of dirs) {
    const config = CONFIG_NAMES.map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
    for (const e of config ? configEntries(fs.readFileSync(config, 'utf8')) : []) {
      if (!isGlob(e)) out.push(path.resolve(dir, e));
      else for (const u of await vscode.workspace.findFiles(new vscode.RelativePattern(dir, e), IGNORE)) out.push(u.fsPath);
    }
  }
  return out;
}

export async function findIconFiles(dirs: string[]): Promise<Found> {
  const found: Found = { entries: await findEntries(dirs), footprints: [], fabDirs: [], zips: [] };
  for (const dir of dirs) {
    for (const u of await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '**/*.{ts,tsx}'), IGNORE, SCAN_LIMIT)) {
      const f = u.fsPath;
      const inLib = path.relative(dir, f).split(path.sep).includes('lib');
      if (inLib || /\bdefineFootprint\s*\(/.test(await readText(f))) found.footprints.push(f);
    }
    const fab = path.join(dir, '.pcbjs', 'fab');
    for (const d of listDir(fab)) {
      if (!d.isDirectory()) continue;
      const board = path.join(fab, d.name);
      found.fabDirs.push(board);
      for (const z of listDir(board)) if (z.isFile() && z.name.endsWith('.zip')) found.zips.push(path.join(board, z.name));
    }
  }
  return found;
}

const listDir = (dir: string) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const readText = (f: string) => fs.promises.readFile(f, 'utf8').catch(() => '');

/** Rewrites the contributed theme file in place, which VS Code reloads since the contribution sets `_watch`. */
export class IconThemeFile {
  private written = '';

  constructor(private readonly root: string) {}

  async refresh(dirs: string[]): Promise<void> {
    if (activeTheme() !== PCBJS_THEME) return;
    const dir = path.join(this.root, 'assets', 'icon-theme');
    let seti: IconTheme;
    try {
      seti = JSON.parse(fs.readFileSync(path.join(dir, 'seti.json'), 'utf8'));
    } catch {
      return;
    }
    const assoc = mergeAssociations(fixedAssociations(), foundAssociations(await findIconFiles(dirs)));
    const text = JSON.stringify(iconTheme(seti, assoc), null, 1) + '\n';
    const file = path.join(dir, 'pcbjs.json');
    if (text === this.written) return;
    try {
      if (fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
      this.written = text;
    } catch {}
  }
}

/** Write the custom associations of the active Material Icon Theme or vscode-icons, so the user keeps that theme. */
export async function associateIcons(root: string, dirs: string[]): Promise<string> {
  const theme = activeTheme();
  const assoc = mergeAssociations(fixedAssociations(), foundAssociations(await findIconFiles(dirs)));
  const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  if (theme === MATERIAL.theme) {
    const ext = vscode.extensions.getExtension(MATERIAL.id);
    if (!ext) return 'Material Icon Theme is active but its extension was not found.';
    // a custom icon must lie under the extensions folder, named relative to Material's dist folder, without `.svg`
    const dist = path.join(ext.extensionPath, 'dist');
    const icon = (i: Icon) => path.relative(dist, path.join(root, 'assets', 'icons', 'tree', 'dark', i)).split(path.sep).join('/');
    const folder = path.relative(dist, path.join(root, 'assets', 'material', 'folder-pcbjs-fab')).split(path.sep).join('/');
    const settings = materialSettings(assoc, icon, folder);
    const cfg = vscode.workspace.getConfiguration();
    for (const [key, value] of Object.entries(settings)) {
      const old = cfg.get<Record<string, string>>(key) ?? {};
      const kept = Object.fromEntries(Object.entries(old).filter(([, v]) => !v.includes('assets/icons/') && !v.includes('assets/material/')));
      await cfg.update(key, { ...kept, ...value }, target);
    }
    return `Material Icon Theme now shows the pcbjs icons for ${Object.keys(settings['material-icon-theme.files.associations']).length} file patterns.`;
  }
  if (theme === VSICONS.theme) {
    const cfg = vscode.workspace.getConfiguration('vsicons');
    const settings = vsiconsSettings(assoc);
    const mine = (e: { icon?: string }) => !!e.icon?.startsWith('pcbjs_');
    const files = (cfg.get<{ icon?: string }[]>('associations.files') ?? []).filter((e) => !mine(e));
    const folders = (cfg.get<{ icon?: string }[]>('associations.folders') ?? []).filter((e) => !mine(e));
    // vscode-icons reads the folder that holds `vsicons-custom-icons`, for every workspace alike
    await cfg.update('customIconFolderPath', path.join(root, 'assets', 'vsicons'), vscode.ConfigurationTarget.Global);
    await cfg.update('associations.files', [...files, ...settings.files], target);
    await cfg.update('associations.folders', [...folders, ...settings.folders], target);
    const cmds = await vscode.commands.getCommands(true);
    if (cmds.includes('vscode-icons.regenerateIcons')) await vscode.commands.executeCommand('vscode-icons.regenerateIcons');
    return 'vscode-icons now shows the pcbjs icons.';
  }
  return `The active file icon theme is ${theme ?? 'none'}. This command writes the settings of Material Icon Theme or vscode-icons; for any other, pick the "pcbjs" file icon theme.`;
}

const UNDO_MS = 20000;

/** The editor side of autoIcons: user settings, globalState and one status bar item that undoes. */
export function iconEnv(context: vscode.ExtensionContext): IconEnv {
  const cfg = () => vscode.workspace.getConfiguration();
  return {
    root: context.extensionPath,
    theme: activeTheme,
    extensionDist: (id) => {
      const ext = vscode.extensions.getExtension(id);
      return ext && path.join(ext.extensionPath, 'dist');
    },
    user: (key) => cfg().inspect(key)?.globalValue,
    setUser: (key, value) => Promise.resolve(cfg().update(key, value, vscode.ConfigurationTarget.Global)),
    stored: (key) => context.globalState.get(key),
    store: (key, value) => Promise.resolve(context.globalState.update(key, value)),
    command: async (id) => {
      if ((await vscode.commands.getCommands(true)).includes(id)) await vscode.commands.executeCommand(id);
    },
    added: (text, undo) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
      const id = `pcbjs.icons.undo.${Date.now()}`;
      const done = () => {
        clearTimeout(timer);
        cmd.dispose();
        item.dispose();
      };
      const cmd = vscode.commands.registerCommand(id, async () => {
        done();
        await undo();
      });
      const timer = setTimeout(done, UNDO_MS);
      item.text = `$(check) ${text} · Undo`;
      item.tooltip = 'Click to remove the file icon settings pcbjs just wrote';
      item.command = id;
      item.show();
    },
    offer: async (text, action) => (await vscode.window.showInformationMessage(text, action)) === action,
  };
}

/** `env` reading and writing the workspace settings, where `pcbjs.icons.associate` writes when a folder is open. */
export function workspaceEnv(env: IconEnv): IconEnv {
  const cfg = () => vscode.workspace.getConfiguration();
  return {
    ...env,
    user: (key) => cfg().inspect(key)?.workspaceValue,
    setUser: (key, value) => Promise.resolve(cfg().update(key, value, vscode.ConfigurationTarget.Workspace)),
  };
}
