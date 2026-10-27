import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import ts from 'typescript';

/** The open documents: the text and version of a file, absolute, or undefined when it is not open. */
export interface OpenDocs { get(file: string): { text: string; version: number } | undefined }

/** One insertion a transform made in a file's text, such as the `;const {U1,R1}=sch` of a schematic namespace. */
export interface Injected { text: string; at: number; length: number }
/** What the language service reads instead of a file's text, `read` giving other files as open or on disk; null leaves it as it is. */
export type Inject = (file: string, text: string, read: (file: string) => string | undefined) => Injected | null | undefined;

/** Without a tsconfig: what `pcbjs create` writes. */
const DEFAULTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: '@pcbjs/core', strict: true, noEmit: true, skipLibCheck: true, allowJs: false, types: [],
};

interface Project { service: ts.LanguageService; files: Set<string> }

export interface Projects {
  /** the program that holds `file`, with the open text of every document */
  program(file: string): ts.Program | undefined;
  /** an offset of the file's own text in the text the service reads, and back */
  toService(file: string, offset: number): number;
  fromService(file: string, offset: number): number;
  service(file: string): ts.LanguageService;
  dispose(): void;
}

export function projects(docs: OpenDocs, inject?: Inject): Projects {
  const byConfig = new Map<string, Project>();
  const injected = new Map<string, { src: string; out: Injected | null }>();
  const raw = (f: string) => docs.get(f)?.text ?? ts.sys.readFile(f);
  const served = (f: string): Injected | null => {
    const src = raw(f);
    if (src === undefined || !inject || !/\.[cm]?tsx?$/.test(f) || f.endsWith('.d.ts')) return null;
    const hit = injected.get(f);
    if (hit?.src === src) return hit.out;
    let out: Injected | null = null;
    try { out = inject(f, src, raw) ?? null; } catch {}
    injected.set(f, { src, out });
    return out;
  };
  const textOf = (f: string) => served(f)?.text ?? raw(f);
  const stamp = (f: string) => { try { return String(statSync(f).mtimeMs); } catch { return '0'; } };

  const make = (config: string | undefined, dir: string): Project => {
    let options = DEFAULTS, names: string[] = [];
    if (config) {
      const read = ts.readConfigFile(config, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, dirname(config));
      options = { ...parsed.options, noEmit: true };
      names = parsed.fileNames;
    }
    const files = new Set(names);
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [...files],
      getScriptVersion: (f) => { const d = docs.get(f); return d ? `open:${d.version}` : stamp(f); },
      getScriptSnapshot: (f) => {
        const text = textOf(f);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => dir,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (f) => !!docs.get(f) || ts.sys.fileExists(f),
      readFile: (f) => textOf(f),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    };
    return { service: ts.createLanguageService(host, ts.createDocumentRegistry()), files };
  };

  const projectOf = (file: string): Project => {
    const config = ts.findConfigFile(dirname(file), ts.sys.fileExists);
    const key = config ?? `dir:${dirname(file)}`;
    let p = byConfig.get(key);
    if (!p) byConfig.set(key, (p = make(config, config ? dirname(config) : dirname(file))));
    p.files.add(file);
    return p;
  };

  return {
    toService: (file, o) => { const i = served(file); return i && o >= i.at ? o + i.length : o; },
    fromService: (file, o) => { const i = served(file); return !i || o < i.at ? o : Math.max(i.at, o - i.length); },
    program: (file) => { try { return projectOf(file).service.getProgram(); } catch { return undefined; } },
    service: (file) => projectOf(file).service,
    dispose: () => { for (const p of byConfig.values()) p.service.dispose(); byConfig.clear(); },
  };
}
