---
name: pcbjs-upgrade
description: Upgrade a pcbjs project to a newer pcbjs release and fix what changed. Use when a project imports from the old single pcbjs package, has a pcbjs.config.ts, uses route path strings, indexes parts by pin position, fails to type-check after a pcbjs update, or when bumping @pcbjs/* versions across a minor release.
---

# Upgrade a pcbjs project

Before 1.0 a minor release may break, a patch may not. Every `@pcbjs/*` package of one release train shares the train's version, and `@pcbjs/pcbjs` pins the exact set, so upgrade them together.

## Steps

1. **Find where you are.** Read the project's `package.json`: a dependency on the unscoped `pcbjs` package, or imports `from 'pcbjs'`, means a project from before the package split; start with references/pre-0.1.md. Otherwise `npm ls @pcbjs/core` gives the version.
2. **Read the migration notes for every minor you cross**, oldest first: references/pre-0.1.md for everything before the changelog, references/changelog.md for each release since, copied from the Migration sections of CHANGELOG.md when this package is published.
3. **Record the baseline** on the old version: `pcbjs check --json before.json` and `pcbjs inspect --lengths > before-lengths.txt` per entry, if the old version runs.
4. **Upgrade the packages together**: `npm install -D @pcbjs/pcbjs@<version> @pcbjs/core@<version> @pcbjs/lib@<version> @pcbjs/fab@<version>` and any other `@pcbjs/*` the project imports, all at one train. `@pcbjs/core` must resolve to one copy. `npx pcbjs doctor` lists every installed `@pcbjs` version, the cache format versions and the config, and exits 1 when two packages differ in major.minor.
5. **Apply the notes**, then let the type checker find the rest: `pcbjs check` runs tsc when the project has a `tsconfig.json`, and each error names the line.
6. **Check cold, then warm.** Delete `.pcbjs/routes` and run `pcbjs check`; run it again and confirm every leg is cached with the same findings. A router change bumps the cache version, so the first compile after an upgrade reroutes anyway; judge the board by that cold result.
7. **Compare with the baseline**: findings by rule, `inspect --lengths`, and for an ordered board the Gerbers. New warnings from new checks are expected; new errors and moved copper need a reason.
8. **Update the docs you own**: comments and READMEs that name old APIs.

## What usually breaks

- Imports and `jsxImportSource` after the package split.
- `U1[7]` meant the seventh pin before; it is now the pad numbered 7.
- A config named `pcbjs.config.ts` still loads, with a warning: rename it to `pcb.config.ts`.
- Route path strings still compile, but a chain is the form the docs, the editor and the findings use.
- Cached routes from an older router are ignored, so locked legs route again once; check them.
- New checks fire on boards that passed before, such as `mask-web` on presets that now carry a mask web; they are warnings and say what to change.

## Rules for the notes themselves

Future migration notes come from CHANGELOG.md: each changeset that breaks something carries a `#### Migration` heading with the before and after, and `scripts/sync-changelog.mjs` copies those sections per minor into references/changelog.md when the package is packed. Do not edit references/changelog.md by hand.
