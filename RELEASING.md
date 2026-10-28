# Releasing

How the `@pcbjs/*` packages are versioned and published from this repository with Changesets.

## Version scheme

- Every package carries in the tree the version of the last train that moved it, written by `release.yml`. `0.0.0` is the placeholder published once by hand to reserve each name on npm and let its trusted publishers be configured; it holds a package.json and a README.md, no code.
- The tree is in pre-release mode with the tag `beta`, `.changeset/pre.json`. Every changeset is a `patch` during the beta, so the trains are `0.0.1-beta.0`, `0.0.1-beta.1` and on, published under the `beta` dist-tag. Users install with `npm install @pcbjs/pcbjs@beta`.
- `latest` stays on the `0.0.0` placeholder for the whole beta. `npx changeset pre exit` ends it: the next train is `0.0.1` under `latest`.
- `pcbjs doctor` compares major.minor, so the whole `0.0.x` line, betas and placeholders included, counts as one version line. Its fix for a skew names the dist-tag of the running CLI, `npm install @pcbjs/pcbjs@beta` during the beta.

## Model

- A release is a train. Every package with a changeset, and every package whose range for one of them no longer covers the new version, gets the train's version; the others keep theirs and are not republished.
- `.changeset/config.json` links every `@pcbjs/*` package: a train's version is the highest bump any changeset asks for, applied from the highest current version in the group.
- `@pcbjs/pcbjs` pins every component exactly, so it is republished whenever any component is, and its version names the train.
- `@pcbjs/core` is a peer dependency, `^0.0.1-beta.0` style, of every package that imports it, and a dependency only of `@pcbjs/pcbjs`.
- After the beta, a minor train moves every package, because `pcbjs doctor` fails when two installed `@pcbjs` packages differ in major.minor; a patch train moves only the changed ones. A minor of core bumps every package with a core peer through the linked group, but not `@pcbjs/step`, `@pcbjs/skills` or `@pcbjs/vscode`, which have none: a minor train's changeset names every package, `npm run changeset` with all of them selected.
- Before 1.0 a minor may break and a patch may not. `@pcbjs/vscode` is private: versioned with the train, shipped inside `@pcbjs/cli` and published to the Visual Studio Marketplace and Open VSX, never to npm.
- The extension's major and minor track those of `@pcbjs/pcbjs`, so extension 0.0.x ships with pcbjs 0.0.x; a patch on either side changes no IDE protocol. A change that breaks an older extension bumps the protocol major in `packages/cli/src/host-client.ts` and `packages/lsp/src/protocol.ts` and adds a row to the table in docs/ide-bridge.md.

## The VS Code extension

- The Marketplace takes only `x.y.z`, so `npm run package -w @pcbjs/vscode` maps the train version of `packages/vscode/package.json` to the extension's version: a pre-release `x.y.z-beta.n` becomes `x.y.(1000z + n)` and a release `x.y.z` becomes `x.y.(1000z + 999)`, so `0.0.1-beta.0` is `0.0.1000`, `0.0.1-beta.4` is `0.0.1004` and `0.0.1` is `0.0.1999`. The mapping keeps major and minor, orders like the train versions, and allows 999 betas per patch. A pre-release VSIX is packaged and published as a pre-release.
- `packages/cli/vscode/manifest.json` holds both, `version` and `train`. `pcbjs ide status` prints both, and `pcbjs ide` reads a pre-release version as the train scheme and a plain one as the Marketplace scheme when it compares the installed extension with the bundled one.
- When a train changed the version of `packages/vscode`, `release.yml` publishes the VSIX it bundled into `@pcbjs/cli` with `vsce publish --pre-release --packagePath` and `ovsx publish`, the Open VSX step allowed to fail. Each step needs its secret, `VSCE_PAT` or `OVSX_TOKEN`, and leaves a notice instead when the secret is not set, so the train still succeeds.
- Every train's GitHub Release carries that VSIX and its `manifest.json`, so the extension of any train can be installed by hand.

## Changesets

Every change to the behaviour of a published package adds one: `npm run changeset`, pick the packages, the bump and a one-line summary for the changelog. Commit the file in `.changeset/` with the change. During the beta every changeset is a `patch`; a `minor` would move the next train to `0.1.0-beta.0`. After the beta a fix is a patch, a new feature or a breaking change a minor. A change to `packages/vscode` names `@pcbjs/cli` too, since the cli ships the VSIX. Docs, tests, examples and CI need none.

## A core-only patch

A changeset for `@pcbjs/core` alone, `patch`, ships `@pcbjs/core` and `@pcbjs/pcbjs` at the next version. Every other package keeps its version, because its peer range still covers the new core: `^0.0.1-beta.0` covers `0.0.1-beta.1`.

## Workflows

- `ci.yml`, on pull requests and pushes to `main`: build and test on Node 22 and 24, `scripts/check-examples.mjs` over every example from a cold route cache, the demo build with every fab set orderable, and `scripts/pack-smoke.mjs` after bundling the VSIX.
- `release.yml`, by hand only, `workflow_dispatch` with the boolean input `dry_run`: versions the pending changesets, commits the train to `main` and publishes it, see Release round below. One job holds `contents: write` to push the commit and the tags, `id-token: write` for npm and `actions: write` to start `pages.yml`.
- `pages.yml`, on pushes to `main` that touch `docs/`, `site/`, `examples/`, `README.md` or the workflow, by hand and after a publish: builds the whole site into one GitHub Pages artifact, since every deploy replaces the site, and deploys it with `actions/deploy-pages` under the workflow's own token, no secret. The stable tree at https://pcbjs.dev comes from the tag `@pcbjs/pcbjs@<version>` with the highest version, the last published train, or from `main` while no train is tagged; the docs of `main` go to https://pcbjs.dev/next/, kept out of search engines.
- `pages.yml` keeps the built stable tree in the Actions cache by its tag, so a later run only copies it in place, and keeps the gallery SVGs and route files of `main` keyed by the content of the packages and the examples; a new train starts from them when its tag and `main` differ in nothing under `packages/`, `examples/` or `site/scripts/`. A push that changes only the packages builds no site; the next push of the site or the next publish shows it.
- `next.yml`, on pushes to `main`: versions the pending changesets as `<next version>-next.<commit sha>`, such as `0.0.1-next.1a2b3c4`, and publishes them under the `next` dist-tag through npm trusted publishing, without tags or commits. With nothing pending it publishes nothing.

The publishing jobs get `id-token: write` for the OIDC exchange and install npm 11.21.1, since trusted publishing needs npm 11.5.1 or later and Node 22.14 or later. npm signs provenance on every trusted publish, and `NPM_CONFIG_PROVENANCE` asks for it explicitly as well. No npm token is stored anywhere.

## Owner setup, by hand

npm can bind a trusted publisher only to a package that exists, so every package is first published by hand as the `0.0.0` placeholder.

1. npm: create the organisation `pcbjs` on npmjs.com and log in with `npm login` as a member allowed to publish, npm 11.5.1 or later.
2. Placeholders, once, from a temporary folder outside the repository, never from the tree: for each package in dependency order, `core`, `step`, `ts-plugin`, `skills`, `lib`, `compile`, `lsp`, `fab`, `kicad`, `export`, `viewer`, `cli`, `pcbjs`, make a folder holding a package.json with the name, `version` `0.0.0`, the description, `license` MIT, `repository` github:pcbjs/pcbjs, `homepage` https://pcbjs.dev and `publishConfig.access` `public`, no dependencies and no code, plus a README.md pointing at https://pcbjs.dev and `npm install @pcbjs/pcbjs@beta`, and run `npm publish --access public --provenance=false` in it, since npm signs provenance only inside CI. npm asks for a one-time password or a browser confirmation per package. `@pcbjs/vscode` is private and is not published. The repository carries no placeholder script or data.
3. Trusted publishers, two per package, from a terminal with npm 11.17 or later, which opens the browser for the second factor on each call: `npm trust github @pcbjs/<name> --file release.yml --repo pcbjs/pcbjs --allow-publish -y` and the same with `next.yml`, for `core`, `step`, `ts-plugin`, `skills`, `lib`, `compile`, `lsp`, `fab`, `kicad`, `export`, `viewer`, `cli` and `pcbjs`. Output must not be piped, or npm refuses the second factor. An entry lapses if nothing publishes through it within two days, so push `main` soon after. `npm trust list @pcbjs/<name>` or the package's Settings page shows what is set.
4. GitHub, the repository `pcbjs/pcbjs`, Settings, Actions, General: Actions allowed, Workflow permissions "Read and write", which `release.yml` needs to push the train's commit and tags to `main`. No repository secret for npm.
5. The docs site, served by GitHub Pages of `pcbjs/pcbjs` itself: Settings, Pages, Source "GitHub Actions", then Custom domain `pcbjs.dev`, Save, and Enforce HTTPS once the certificate is issued; GitHub lets only one repository claim a domain, so remove `pcbjs.dev` from any other repository's Pages settings first. The DNS records of `pcbjs.dev` already point the apex at GitHub Pages; site/README.md lists them. No secret is needed.
6. The extension: the publisher `pcbjs` on the Visual Studio Marketplace, with an Azure DevOps personal access token scoped to Marketplace, Manage, saved in `pcbjs/pcbjs` as the repository secret `VSCE_PAT`; and the namespace `pcbjs` on Open VSX, `npx ovsx create-namespace pcbjs -p <token>`, with that token saved as `OVSX_TOKEN`. Without them the `vscode` job publishes nothing and says so.
7. Recommended once the first workflow publish has worked: each package's Settings, Publishing access, "Require two-factor authentication and disallow tokens". Trusted publishing is not affected.
8. Recommended: protect `main`, requiring the CI checks, with GitHub Actions allowed to bypass, since `release.yml` pushes the train's commit straight to `main`.

## Release round

Releases are direct: no pull request, `release.yml` versions and publishes in one run, started by hand.

1. Commit every held change to `main`, each behaviour change with its changeset, push, and wait for CI to pass on that commit.
2. Optional: `gh workflow run release.yml --ref main -f dry_run=true`. The run versions the pending changesets and prints the commit subject, `git diff --stat`, every package's new version and the release notes, then stops; it pushes and publishes nothing.
3. `gh workflow run release.yml --ref main`, then `gh run watch`.

The run, one job on ubuntu:

1. Checks out `main` with full history and fails at once when `.changeset` holds no pending changeset.
2. `npx changeset version` in the pre mode of `.changeset/pre.json`, which moves every changed package and `@pcbjs/pcbjs` to the next beta and writes the changelogs, then `npm install --package-lock-only`. It commits the result as `pcbjs <version of @pcbjs/pcbjs>` as `github-actions[bot]` and pushes it to `main`.
3. Builds, bundles the VSIX into `@pcbjs/cli`, installs npm 11.21.1 and runs `npx changeset publish` with provenance: every package whose version is not on npm, in dependency order, under the `beta` dist-tag of pre mode. It pushes the `@pcbjs/<pkg>@<version>` tags that publish created.
4. Publishes the extension when the train moved it, see The VS Code extension.
5. Creates one GitHub Release per train on the tag `@pcbjs/pcbjs@<version>`, titled `pcbjs <version>` and marked pre-release while the version has a pre-release tag. Its notes are the train's changelog sections of every package it moved, one heading per package, from `scripts/release-notes.mjs`; a package whose only entry is a dependency bump is left out. Its assets are the VSIX and `packages/cli/vscode/manifest.json`. `changeset publish` makes no release of its own.
6. Starts `pages.yml` with `gh workflow run`, so https://pcbjs.dev shows the new train.

The commit pushed by the workflow's token starts no workflow, so CI does not run on it. That is fine: it changes only versions, changelogs and the lockfile on top of a `main` that was green when the run started.

A push rejected because `main` moved during the run fails the run before anything is published; start it again with `gh workflow run release.yml --ref main`. A run that fails after its push, in the publish or later, is also started again the same way: it finds no pending changeset but a `@pcbjs/pcbjs` version on `main` without its tag, skips the versioning and publishes what npm lacks, then tags and makes the release, which it skips when one exists.

The first train, `0.0.1-beta.0`, went out through the former pull request "Version packages"; every later train is a release round until `npx changeset pre exit` makes the next one `0.0.1` under `latest`. After a train, `npm view @pcbjs/pcbjs dist-tags` shows `latest: 0.0.0` and the new `beta`, and each package page on npmjs.com shows the provenance badge.
