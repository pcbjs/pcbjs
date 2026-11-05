# Releasing

How the `@pcbjs/*` packages are versioned and published from this repository with Changesets.

## Version scheme

- Every package carries in the tree the version of the last train that moved it, written by `release.yml`. `0.0.0` is the placeholder published once by hand to reserve each name on npm and let its trusted publishers be configured; it holds a package.json and a README.md, no code.
- The next prepared release is **0.1.1**, under `latest`. The tree is on the stable 0.1 line, with pending patch changesets and no prerelease state. Keep manifests at their last released versions; the workflow calculates the patch train.
- `pcbjs doctor` compares major.minor. Install the 0.1 components together through `@pcbjs/pcbjs`; its repair command uses `latest` for stable releases.

## Model

- A release is a train. Every package with a changeset, and every package whose range for one of them no longer covers the new version, gets the train's version; the others keep theirs and are not republished.
- `.changeset/config.json` links every `@pcbjs/*` package: a train's version is the highest bump any changeset asks for, applied from the highest current version in the group.
- `@pcbjs/pcbjs` pins every component exactly, so it is republished whenever any component is, and its version names the train.
- `@pcbjs/core` is a peer dependency, `^0.1.0` style, of every package that imports it, and a dependency only of `@pcbjs/pcbjs`.
- A minor train moves every package, because `pcbjs doctor` fails when two installed `@pcbjs` packages differ in major.minor; a patch train moves only the changed ones. A minor of core bumps every package with a core peer through the linked group, but not `@pcbjs/step`, `@pcbjs/skills` or `@pcbjs/vscode`, which have none: a minor train's changeset names every package, `npm run changeset` with all of them selected.
- Before 1.0 a minor may break and a patch may not. `@pcbjs/vscode` is private: versioned with the train, shipped inside `@pcbjs/cli` and published to the Visual Studio Marketplace and Open VSX, never to npm.
- The extension's major and minor track those of `@pcbjs/pcbjs`, so extension 0.1.x ships with pcbjs 0.1.x; a patch on either side changes no IDE protocol. A change that breaks an older extension bumps `MAJOR` in `packages/core/src/protocol.ts` and updates the version described in docs/ide-bridge.md.

## The VS Code extension

- The Marketplace takes only `x.y.z`, so `npm run package -w @pcbjs/vscode` maps the train version of `packages/vscode/package.json` to the extension's version: a pre-release `x.y.z-beta.n` becomes `x.y.(1000z + n)` and a release `x.y.z` becomes `x.y.(1000z + 999)`, so `0.0.1-beta.0` is `0.0.1000`, `0.0.1-beta.4` is `0.0.1004` and `0.1.0` is `0.1.999`. The mapping keeps major and minor, orders like the train versions, and allows 999 betas per patch. A pre-release VSIX is packaged and published as a pre-release.
- `packages/cli/vscode/manifest.json` holds both, `version` and `train`. `pcbjs ide status` prints both, and `pcbjs ide` reads a pre-release version as the train scheme and a plain one as the Marketplace scheme when it compares the installed extension with the bundled one.
- When a train changed the version of `packages/vscode`, `release.yml` publishes the VSIX it bundled into `@pcbjs/cli` with `vsce publish --packagePath` and `ovsx publish`, adding `--pre-release` only for prerelease trains, the Open VSX step allowed to fail. Each step needs its secret, `VSCE_PAT` or `OVSX_TOKEN`, and leaves a notice instead when the secret is not set, so the train still succeeds.
- Every train's GitHub Release carries that VSIX and its `manifest.json`, so the extension of any train can be installed by hand.

## Changesets

Every change to the behaviour of a published package adds one: `npm run changeset`, pick the packages, the bump and a one-line summary for the changelog. Commit the file in `.changeset/` with the change. A fix is a patch; a new feature or a breaking change before 1.0 is a minor. A change to `packages/vscode` names `@pcbjs/cli` too, since the cli ships the VSIX. Docs, tests, examples and CI need none.

## The 0.1.1 patch

Pending patch changesets describe the changed packages. Before dispatch, inspect the Changesets release plan: affected linked packages and exact dependency dependents should select `0.1.1`; unaffected packages may remain at `0.1.0`. The private extension is versioned when selected, with train `0.1.1` mapped to Marketplace `0.1.1999` and `preRelease: false`. No beta exit or all-package minor changeset is needed.

The dry run must validate that calculated tree and packed runtime before publication. Local tarball overrides prove packaging, not registry availability or dist-tags. After publishing, install `@pcbjs/pcbjs@<train>` in a fresh folder without overrides, run `pcbjs create`, install that project and check and build it; verify `latest` names the intended stable train. New public packages still require placeholder/trusted-publisher setup first.

## A core-only patch

A changeset for `@pcbjs/core` alone, `patch`, ships `@pcbjs/core` and `@pcbjs/pcbjs` at the next version. Every other package keeps its version, because its peer range still covers the new core: `^0.1.0` covers `0.1.1`.

## Workflows

- `ci.yml`, on pull requests and pushes to `main`: build and test on Node 22 and 24, `scripts/check-examples.mjs` over every example from a cold route cache, the demo build with every fab set orderable, and `scripts/pack-smoke.mjs` after bundling the VSIX.
- `release.yml`, by hand only, `workflow_dispatch` with `dry_run` and an optional exact `resume_version`: versions a new train, builds, tests and installs its tarballs before pushing or publishing it, see Release round below. One job holds `contents: write` to push the commit and the tags, `id-token: write` for npm and `actions: write` to start `pages.yml`.
- `pages.yml`, on pushes to `main` that touch `docs/`, `site/`, `examples/`, `README.md` or the workflow, by hand and after a publish: builds the whole site into one GitHub Pages artifact, since every deploy replaces the site, and deploys it with `actions/deploy-pages` under the workflow's own token, no secret. The site of `main` is https://pcbjs.dev, so site work shows as soon as it is pushed; the docs of the last published train, the tag `@pcbjs/pcbjs@<version>` with the highest version, go to https://pcbjs.dev/stable/, kept out of search engines, and the old https://pcbjs.dev/next/ redirects to the root.
- `pages.yml` keeps the built stable tree in the Actions cache by its tag, so a later run only copies it in place, and keeps the gallery SVGs and route files of `main` keyed by the content of the packages and the examples; a new train starts from them when its tag and `main` differ in nothing under `packages/`, `examples/` or `site/scripts/`. A push that changes only the packages builds no site; the next push of the site or the next publish shows it.
- `next.yml`, on pushes to `main`: versions the pending changesets as `<next version>-next.<commit sha>`, such as `0.1.1-next.1a2b3c4`, and publishes them under the `next` dist-tag through npm trusted publishing, without tags or commits. With nothing pending it publishes nothing.

The publishing jobs get `id-token: write` for the OIDC exchange and install npm 11.21.1, since trusted publishing needs npm 11.5.1 or later and Node 22.14 or later. npm signs provenance on every trusted publish, and `NPM_CONFIG_PROVENANCE` asks for it explicitly as well. No npm token is stored anywhere.

## Owner setup, by hand

npm can bind a trusted publisher only to a package that exists, so every package is first published by hand as the `0.0.0` placeholder.

1. npm: create the organisation `pcbjs` on npmjs.com and log in with `npm login` as a member allowed to publish, npm 11.5.1 or later.
2. Placeholders, once, from a temporary folder outside the repository, never from the tree: for each package in dependency order, `core`, `step`, `ts-plugin`, `skills`, `lib`, `compile`, `lsp`, `fab`, `kicad`, `export`, `ui`, `viewer`, `cli`, `pcbjs`, make a folder holding a package.json with the name, `version` `0.0.0`, the description, `license` MIT, `repository` github:pcbjs/pcbjs, `homepage` https://pcbjs.dev and `publishConfig.access` `public`, no dependencies and no code, plus a README.md pointing at https://pcbjs.dev and `npm install @pcbjs/pcbjs@latest`, and run `npm publish --access public --provenance=false` in it, since npm signs provenance only inside CI. npm asks for a one-time password or a browser confirmation per package. `@pcbjs/vscode` is private and is not published. The repository carries no placeholder script or data.
3. Trusted publishers, two per package, from a terminal with npm 11.17 or later, which opens the browser for the second factor on each call: `npm trust github @pcbjs/<name> --file release.yml --repo pcbjs/pcbjs --allow-publish -y` and the same with `next.yml`, for `core`, `step`, `ts-plugin`, `skills`, `lib`, `compile`, `lsp`, `fab`, `kicad`, `export`, `ui`, `viewer`, `cli` and `pcbjs`. Output must not be piped, or npm refuses the second factor. An entry lapses if nothing publishes through it within two days, so push `main` soon after. `npm trust list @pcbjs/<name>` or the package's Settings page shows what is set.
4. GitHub, the repository `pcbjs/pcbjs`, Settings, Actions, General: Actions allowed, Workflow permissions "Read and write", which `release.yml` needs to push the train's commit and tags to `main`. No repository secret for npm.
5. The docs site, served by GitHub Pages of `pcbjs/pcbjs` itself: Settings, Pages, Source "GitHub Actions", then Custom domain `pcbjs.dev`, Save, and Enforce HTTPS once the certificate is issued; GitHub lets only one repository claim a domain, so remove `pcbjs.dev` from any other repository's Pages settings first. The DNS records of `pcbjs.dev` already point the apex at GitHub Pages; site/README.md lists them. No secret is needed.
6. The extension: the publisher `pcbjs` on the Visual Studio Marketplace, with an Azure DevOps personal access token scoped to Marketplace, Manage, saved in `pcbjs/pcbjs` as the repository secret `VSCE_PAT`; and the namespace `pcbjs` on Open VSX, `npx ovsx create-namespace pcbjs -p <token>`, with that token saved as `OVSX_TOKEN`. Without them the `vscode` job publishes nothing and says so.
7. Recommended once the first workflow publish has worked: each package's Settings, Publishing access, "Require two-factor authentication and disallow tokens". Trusted publishing is not affected.
8. Recommended: protect `main`, requiring the CI checks, with GitHub Actions allowed to bypass, since `release.yml` pushes the train's commit straight to `main`.

## Release round

Releases are direct: no pull request. A new run versions and validates the train before pushing or publishing. A recovery names an exact train instead of inferring one from a missing tag.

1. Commit every held change to `main`, each behaviour change with its changeset, push, and wait for the full CI matrix to pass on that commit.
2. Run `gh workflow run release.yml --ref main -f dry_run=true`. The run versions the pending changesets locally, builds, packages the extension, runs the tests, checks every example and its stage-cache equality, builds the demo with every fab set orderable, and installs and exercises the tarballs, including shots. It prints the versions and release notes after validation and pushes and publishes nothing.
3. Inspect that run, then `gh workflow run release.yml --ref main` and `gh run watch`. The real run repeats validation against the current main; a dry run does not reserve a version or freeze main.

The run, one job on Ubuntu:

1. Checks out `main` with full history. A new train requires a pending changeset or an explicit prerelease exit. With neither, it fails rather than guessing that the current package version is an incomplete release.
2. Installs npm 11.21.1 and runs `npm ci`. For a new train, `npx changeset version` calculates the versions and changelogs, the example templates are synced, and `npm install --package-lock-only` updates the lock. It commits the result as `pcbjs <version of @pcbjs/pcbjs>` in the runner.
3. Builds that versioned tree, bundles the VSIX, fetches the models and installs the libraries the tests use, runs `npm test`, checks every example cold and runs `scripts/stage-equality.mjs` through cold, warm and cache-recovery paths, builds the demo and checks its fab sets are orderable, and runs `scripts/pack-smoke.mjs`. A tracked change left by validation fails the run. Dry runs stop after printing this validated train.
4. Pushes the new version commit to main only after validation. A rejected push means main moved, and nothing from this run is published. Start a new run against the updated main.
5. Runs `npx changeset publish` with provenance to publish missing npm versions in dependency order. An active prerelease state chooses its tag; a stable release uses `latest`. It pushes package tags and ensures the train's meta-package tag exists even on a retry that finds the npm versions already published.
6. Publishes the extension when a new train moved it, see The VS Code extension. Recovery runs skip extension registries to avoid republishing a version a previous attempt already sent.
7. Creates the GitHub Release on `@pcbjs/pcbjs@<version>`, titled `pcbjs <version>`, marked pre-release only when the version has a prerelease tag. Notes come from `scripts/release-notes.mjs`; above 100,000 characters it links to the package changelogs at the release tag, keeping below GitHub's body limit. It uploads the VSIX and its manifest when those assets are missing, including on an existing release whose asset upload failed earlier.
8. Starts `pages.yml` so https://pcbjs.dev shows the train.

The workflow token's version commit starts no CI workflow. The versioned tree has already passed the release validation in step 3; the full platform and browser matrix remains the prerequisite on the source commit.

## Recovering a release

If a run failed before its version commit reached main, fix the failure and start a normal run. After the version commit was pushed, use `gh workflow run release.yml --ref main -f resume_version=<exact-version>`, optionally with `-f dry_run=true` to validate the recovery first.

- With no train tag, the requested version must be the current main package version, main's commit subject must be `pcbjs <exact-version>`, and there must be no pending changesets or prerelease exit. The run validates that commit, retries only missing npm versions, restores the train tag and finishes the release and site.
- With a train tag, that tag must resolve to a version commit on main's history with the requested package version. The run checks out that exact commit even if main has advanced, validates it, skips npm publication, and finishes the GitHub Release, missing assets and site dispatch.
- Every recovery skips Marketplace and Open VSX publication. Check each registry for the exact extension version in the release's `manifest.json`; if one is missing, retry only that registry with the release's VSIX using the publication command in `release.yml`. Keep the prerelease flag from the manifest. A missing-token notice or an Open VSX failure still needs this owner action; recovery never assumes either registry succeeded.

The resume selector accepts version commits made by this release workflow. An old tag on a different kind of commit needs manual inspection and recovery. GitHub Release assets already present are kept; replace a corrupt asset only after inspecting it.

The first train, 0.0.1-beta.0, used the former Version packages pull request. Later trains use this release round; choose the stable version explicitly as described above. After a train, check `npm view @pcbjs/pcbjs dist-tags` and the provenance badge on its npm page. For this patch, confirm `latest` points to the released `0.1.1` train.
