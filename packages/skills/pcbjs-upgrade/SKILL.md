---
name: pcbjs-upgrade
description: Upgrade a pcbjs project to a newer pcbjs release and verify the board still compiles to the same copper. Use when bumping @pcbjs/* versions, when a project fails to type-check after a pcbjs update, or when pcbjs doctor reports packages that disagree.
---

# Upgrade a pcbjs project

Before 1.0 a minor release may break, a patch may not. Every `@pcbjs/*` package of one release train shares the train's version, and `@pcbjs/pcbjs` pins the exact set, so upgrade them together.

## Work split and reading

Keep a small version update in one agent. For a multi-board migration, use focused workers when delegation is available and permitted: one owner changes dependencies and shared APIs, while board-specific compatibility reviews can run independently. Workers load only changelog entries and topics relevant to their assigned packages or boards, and return affected paths, intentional differences, check results and risks. The coordinator keeps the version/baseline matrix and verifies the integrated upgrade; it does not ingest every changelog or raw check log.

Do not load all references or documentation in advance. Use the topic index or a targeted search to locate the next required detail.

## Steps

1. **Find where you are.** `npm ls @pcbjs/core` gives the installed version; `npx pcbjs doctor` lists every installed `@pcbjs` version, the cache format versions and the config, and exits 1 when two packages differ in major.minor.
2. **Record the baseline** on the old version: `pcbjs check --json before.json` and `pcbjs inspect --lengths > before-lengths.txt` per entry, and `pcbjs build` for an ordered board so its Gerbers can be compared.
3. **Upgrade the packages together**: `npm install -D @pcbjs/pcbjs@<version> @pcbjs/core@<version> @pcbjs/lib@<version> @pcbjs/fab@<version>` and any other `@pcbjs/*` the project imports, all at one train. `@pcbjs/core` must resolve to one copy.
4. **Read the changelog entries you cross** with `npm view @pcbjs/pcbjs` or the CHANGELOG.md of each package, then let the type checker find the rest: `pcbjs check` runs tsc when the project has a `tsconfig.json`, and each error names the line. `pcbjs docs <topic>` describes the current form of anything that changed.
5. **Check cold, then warm.** Run `pcbjs check --fresh=all`; run it again and confirm every leg is cached with the same findings. A router change bumps the cache version, so the first compile after an upgrade reroutes anyway; judge the board by that cold result.
6. **Compare with the baseline**: findings by rule, `inspect --lengths`, and for an ordered board the Gerbers. New warnings from new checks are expected and say what to change; new errors and moved copper need a reason.
7. **Update the docs you own**: comments and READMEs that name old APIs.
