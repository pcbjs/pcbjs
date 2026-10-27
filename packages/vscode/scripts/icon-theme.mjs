// Builds the opt-in file icon theme `pcbjs` into assets/icon-theme: VS Code's Seti theme, MIT in microsoft/vscode, with the
// pcbjs icons on top. The Seti source is fetched once into node_modules/.cache with its licence texts beside it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The microsoft/vscode tag the Seti files come from. */
const REF = '1.105.0';
const RAW = `https://raw.githubusercontent.com/microsoft/vscode/${REF}`;
const FILES = {
  'vs-seti-icon-theme.json': 'extensions/theme-seti/icons/vs-seti-icon-theme.json',
  'seti.woff': 'extensions/theme-seti/icons/seti.woff',
  'ThirdPartyNotices.txt': 'extensions/theme-seti/ThirdPartyNotices.txt',
  'LICENSE.txt': 'LICENSE.txt',
};

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = resolve(here, '../../node_modules/.cache/pcbjs-seti', REF);
const out = join(here, 'assets', 'icon-theme');

mkdirSync(cache, { recursive: true });
for (const [name, src] of Object.entries(FILES)) {
  const file = join(cache, name);
  if (existsSync(file)) continue;
  let res;
  try {
    res = await fetch(`${RAW}/${src}`);
  } catch (err) {
    fail(`cannot fetch ${RAW}/${src}: ${err.cause?.message ?? err.message}`);
  }
  if (!res.ok) fail(`cannot fetch ${RAW}/${src}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const { fixedAssociations, iconTheme } = await import(join(here, 'dist/icon-map.cjs')).then((m) => m.default ?? m);
const seti = JSON.parse(readFileSync(join(cache, 'vs-seti-icon-theme.json'), 'utf8'));
delete seti.information_for_contributors;
mkdirSync(out, { recursive: true });
copyFileSync(join(cache, 'seti.woff'), join(out, 'seti.woff'));
writeFileSync(join(out, 'seti.json'), JSON.stringify(seti) + '\n');
writeFileSync(join(out, 'pcbjs.json'), JSON.stringify(iconTheme(seti, fixedAssociations()), null, 1) + '\n');
writeFileSync(
  join(out, 'LICENSE-seti.txt'),
  `The Seti icon theme here, seti.json, seti.woff and the Seti part of pcbjs.json, comes from microsoft/vscode ${REF},\nextensions/theme-seti, under the licence below, with its third party notice after it.\n\n${readFileSync(join(cache, 'LICENSE.txt'), 'utf8')}\n\n${readFileSync(join(cache, 'ThirdPartyNotices.txt'), 'utf8')}`,
);
console.log(`wrote ${out}: Seti from microsoft/vscode ${REF} with the pcbjs icons`);

function fail(msg) {
  console.error(`icon theme: ${msg}\nThe pcbjs icon theme needs VS Code's Seti theme once; it is cached in ${cache} afterwards.`);
  process.exit(1);
}
