// The file icons set up on activation for the active icon theme, without vscode: the editor comes in as `IconEnv`.

import * as path from 'node:path';
import { fixedAssociations, materialSettings, vsiconsSettings, type Icon, type VsiconsEntry } from './icon-map';

export const MATERIAL = { id: 'PKief.material-icon-theme', theme: 'material-icon-theme', name: 'Material Icon Theme', prefix: 'material-icon-theme.' };
export const VSICONS = { id: 'vscode-icons-team.vscode-icons', theme: 'vscode-icons', name: 'vscode-icons', prefix: 'vsicons.' };
export const PCBJS_THEME = 'pcbjs';
const DEFAULT_THEME = 'vs-seti';
/** globalState key: the notice offering the pcbjs icon theme was shown */
export const OFFERED = 'pcbjs.iconThemeOffered';
/** globalState key: `workbench.iconTheme` before the offer switched it to pcbjs */
export const THEME_BEFORE = 'pcbjs.iconThemeBefore';
/** globalState key: the user's `vsicons.customIconFolderPath` before ours replaced it */
export const FOLDER_BEFORE = 'pcbjs.vsiconsFolderBefore';

const MATERIAL_KEYS = ['material-icon-theme.files.associations', 'material-icon-theme.folders.associations'];
const VSICONS_KEYS = ['vsicons.associations.files', 'vsicons.associations.folders'];
const VSICONS_FOLDER = 'vsicons.customIconFolderPath';

export interface IconEnv {
  /** the extension's own folder */
  root: string;
  theme(): string | undefined;
  /** the `dist` folder of an installed extension by id */
  extensionDist(id: string): string | undefined;
  /** a setting as the user settings hold it */
  user(key: string): unknown;
  setUser(key: string, value: unknown): Promise<void>;
  stored(key: string): unknown;
  store(key: string, value: unknown): Promise<void>;
  /** runs a command when some extension registered it */
  command(id: string): Promise<void>;
  /** a status bar message whose click undoes */
  added(text: string, undo: () => Promise<void>): void;
  /** a notice with one action; resolves true when it was taken */
  offer(text: string, action: string): Promise<boolean>;
}

type Plan = { theme: string; writes: Record<string, unknown>; remember?: Record<string, unknown> };

const posix = (p: string) => p.split(path.sep).join('/');
const ours = (v: unknown) => typeof v === 'string' && /assets\/(icons|material)\//.test(v);
const mine = (e: { icon?: string }) => !!e.icon?.startsWith('pcbjs_');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ourFolder = (v: unknown) => typeof v === 'string' && /pcbjs.*assets[/\\]vsicons$/.test(v);

/** Material wants each icon as a path without `.svg`, relative to its own `dist` folder. */
export function materialPlan(env: IconEnv, dist: string): Plan {
  const icon = (i: Icon) => posix(path.relative(dist, path.join(env.root, 'assets', 'icons', 'dark', i)));
  const folder = posix(path.relative(dist, path.join(env.root, 'assets', 'material', 'folder-pcbjs-fab')));
  const wanted = materialSettings(fixedAssociations(), icon, folder);
  const writes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wanted)) {
    const old = (env.user(key) ?? {}) as Record<string, string>;
    const kept = Object.fromEntries(Object.entries(old).filter(([k, v]) => !(k in value) && !ours(v)));
    if (Object.entries(value).some(([k, v]) => old[k] !== v)) writes[key] = { ...kept, ...value };
  }
  return { theme: MATERIAL.name, writes };
}

export function vsiconsPlan(env: IconEnv): Plan {
  const wanted = vsiconsSettings(fixedAssociations());
  const folder = path.join(env.root, 'assets', 'vsicons');
  const writes: Record<string, unknown> = {};
  for (const [key, list] of [[VSICONS_KEYS[0], wanted.files], [VSICONS_KEYS[1], wanted.folders]] as const) {
    const old = (env.user(key) ?? []) as VsiconsEntry[];
    if (!same(old.filter(mine), list)) writes[key] = [...old.filter((e) => !mine(e)), ...list];
  }
  const prev = env.user(VSICONS_FOLDER);
  if (prev !== folder) writes[VSICONS_FOLDER] = folder;
  const remember = typeof prev === 'string' && !ourFolder(prev) ? { [FOLDER_BEFORE]: prev } : undefined;
  return { theme: VSICONS.name, writes, remember };
}

/** The user settings with the extension's icons taken out, for each key that holds some; undefined drops a key left empty. */
export function revokeWrites(env: IconEnv): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of MATERIAL_KEYS) {
    const old = Object.entries((env.user(key) ?? {}) as Record<string, string>);
    const kept = old.filter(([, v]) => !ours(v));
    if (kept.length < old.length) out[key] = kept.length ? Object.fromEntries(kept) : undefined;
  }
  for (const key of VSICONS_KEYS) {
    const old = (env.user(key) ?? []) as VsiconsEntry[];
    const kept = old.filter((e) => !mine(e));
    if (kept.length < old.length) out[key] = kept.length ? kept : undefined;
  }
  if (ourFolder(env.user(VSICONS_FOLDER))) out[VSICONS_FOLDER] = env.stored(FOLDER_BEFORE);
  return out;
}

/** Takes the extension's associations out of the settings `env` holds; returns the names of the themes touched. */
export async function removeIcons(env: IconEnv): Promise<string[]> {
  const writes = revokeWrites(env);
  for (const [key, value] of Object.entries(writes)) await env.setUser(key, value);
  if (VSICONS_FOLDER in writes) await env.store(FOLDER_BEFORE, undefined);
  return [MATERIAL, VSICONS].filter((t) => Object.keys(writes).some((k) => k.startsWith(t.prefix))).map((t) => t.name);
}

/** Undoes every file icon change the extension made, in each settings scope; returns the message to show. */
export async function revokeIcons(env: IconEnv, scopes: IconEnv[] = [env]): Promise<string> {
  const themes = new Set<string>();
  for (const s of scopes) for (const t of await removeIcons(s)) themes.add(t);
  const removed = [...themes].map((t) => `the ${t} associations`);
  if (env.theme() === PCBJS_THEME) {
    const back = (env.stored(THEME_BEFORE) as string | undefined) ?? DEFAULT_THEME;
    await env.setUser('workbench.iconTheme', back);
    removed.push(`the pcbjs icon theme, back to ${back}`);
  }
  await env.store(THEME_BEFORE, undefined);
  await env.store(OFFERED, undefined);
  await env.command('vscode-icons.regenerateIcons');
  if (!removed.length) return 'pcbjs: no pcbjs file icons to remove.';
  return `pcbjs: removed ${removed.length > 1 ? `${removed.slice(0, -1).join(', ')} and ${removed.at(-1)}` : removed[0]}.`;
}

/** Run on activation and on a change of `workbench.iconTheme`; writes only what is missing or stale. */
export async function autoIcons(env: IconEnv): Promise<string | undefined> {
  const theme = env.theme();
  if (theme === PCBJS_THEME) return undefined;
  const dist = theme === MATERIAL.theme ? env.extensionDist(MATERIAL.id) : undefined;
  const plan = dist ? materialPlan(env, dist) : theme === VSICONS.theme ? vsiconsPlan(env) : undefined;
  if (!plan) {
    if (theme === MATERIAL.theme || env.stored(OFFERED) === true) return undefined;
    await env.store(OFFERED, true);
    if (!(await env.offer('pcbjs: boards, schematics and configs have their own file icons in the pcbjs file icon theme.', 'Use pcbjs icons'))) return undefined;
    await env.store(THEME_BEFORE, theme);
    await env.setUser('workbench.iconTheme', PCBJS_THEME);
    return undefined;
  }
  if (!Object.keys(plan.writes).length) return undefined;
  for (const [key, value] of Object.entries(plan.remember ?? {})) await env.store(key, value);
  for (const [key, value] of Object.entries(plan.writes)) await env.setUser(key, value);
  const text = `pcbjs: file icons added to ${plan.theme}`;
  env.added(text, async () => void (await removeIcons(env)));
  return text;
}
