# The pcbjs docs site

The VitePress project behind https://pcbjs.dev, with the docs of `main` at https://pcbjs.dev/next/. It renders the topic files in `docs/` where they are, the same files `pcbjs docs` prints, and adds its own pages beside them.

## Commands

From the repository root, after `npm install` and `npm run build`:

```sh
npm run docs:dev        # the site with hot reload, on http://localhost:5173; add -- --port <n> for another port
npm run docs:build      # the gallery data and shots when Chrome is found, then the site in site/.vitepress/dist
npm run docs:preview    # serve the built site; add -- --port <n> for another port
npm run boards -w pcbjs-site -- --commit   # refresh the committed gallery fallbacks
```

## What is where

| Path | What |
| --- | --- |
| `.vitepress/config.mts` | the site config: nav, search, themes, the brand slot, the edit links |
| `.vitepress/topics.ts` | reads `docs/*.md`: titles, the two-line summary as the page description, the sidebar groups, the README's For agents section and the changelog |
| `docs/[topic].md`, `docs/[topic].paths.ts` | one page per topic file at `/docs/<topic>`, a dynamic route over `docs/`, so nothing is copied |
| `[page].md`, `[page].paths.ts` | `/agents` from the README's For agents section, `/changelog` from `CHANGELOG.md`, else `packages/pcbjs/CHANGELOG.md` |
| `index.md`, `getting-started.md`, `why.md`, `examples.md` | the site's own pages; their `tsx` samples are type checked by `packages/pcbjs/tests/site-samples.test.mjs` |
| `examples.data.ts`, `.vitepress/theme/Gallery.vue` | the gallery: one card per board under `examples/`, its text from `examples/README.md` and the entry's first comment line |
| `scripts/boards.mjs` | runs `pcbjs check --json` and `pcbjs shot` in every example project and writes WebP shots and `boards.json` |
| `data/boards.json`, `public/shots/` | the committed fallbacks, used when a build has no Chrome; keep `public/shots` under 3 MB |
| `.shots/` | what `docs:build` generated, untracked; preferred over the fallbacks and copied over them into the build |
| `brand/` | `logo.svg` and `favicon.svg`, the nav logo and the favicon when the files exist, and `og.png`, the Open Graph image |

A new topic file in `docs/` becomes a page on the next build. Put it in a sidebar group in `groups` in `.vitepress/topics.ts`; a topic in no group lands in Background. Topic files keep their plain style for the terminal: a mention such as `board.md` in prose becomes a link on the site, and the page is wrapped in `v-pre`, so `{{` in a sample is safe.

## Deployment

`.github/workflows/pages.yml` builds both trees into one GitHub Pages artifact of `pcbjs/pcbjs`, since every deploy replaces the whole site, and deploys it with `actions/deploy-pages` under the workflow's own token; no secret and no other repository. It runs on every push to `main`, by hand with Run workflow, and from `release.yml` after a publish.

| Path | Tree | Built from |
| --- | --- | --- |
| https://pcbjs.dev/ | the stable docs | the tag `@pcbjs/pcbjs@<version>` with the highest version, the last published train; `main` while no train is tagged |
| https://pcbjs.dev/next/ | the docs of `main` | `main`, with `PCBJS_SITE_BASE=/next/` and a `noindex` robots meta |

Each tree runs `npm ci`, `npm run build` and `npm run docs:build -- --outDir <dir>` on ubuntu-latest, which has Chrome; the workflow caches the examples' route files, and `site/.shots` until a package changes, so a docs-only push shoots only the examples that changed and every check routes warm. `scripts/boards.mjs` takes the three views of a project in one `pcbjs shot --view all`. `PCBJS_SITE_URL` sets the host in the sitemap, the canonical links and the Open Graph tags, `https://pcbjs.dev` by default; `PCBJS_SITE_BASE` sets the VitePress `base`, `/` by default, and any other base adds the `noindex` meta. The workflow writes `CNAME` and `.nojekyll` at the artifact root.

The one-time setup is in RELEASING.md, Owner setup: Pages source "GitHub Actions" and the custom domain `pcbjs.dev` with HTTPS enforced.

### DNS for pcbjs.dev

At the registrar, with no other `A`, `AAAA` or `CNAME` records on these names:

| Name | Type | Value |
| --- | --- | --- |
| `@` | `A` | `185.199.108.153` |
| `@` | `A` | `185.199.109.153` |
| `@` | `A` | `185.199.110.153` |
| `@` | `A` | `185.199.111.153` |
| `@` | `AAAA` | `2606:50c0:8000::153` |
| `@` | `AAAA` | `2606:50c0:8001::153` |
| `@` | `AAAA` | `2606:50c0:8002::153` |
| `@` | `AAAA` | `2606:50c0:8003::153` |
| `www` | `CNAME` | `pcbjs.github.io` |

- `www.pcbjs.dev` redirects to `pcbjs.dev` once `pcbjs.dev` is the Pages custom domain of `pcbjs/pcbjs`; nothing else is needed for it.
- Verify the domain for the organisation, Settings, Pages, Add a domain, with the `TXT` record GitHub shows, so no other account can claim a subdomain.
- `.dev` is on the HSTS preload list, so browsers only ever load the site over HTTPS; until the certificate is issued the site does not open.
- Check with `dig +short pcbjs.dev A` and `dig +short pcbjs.dev AAAA`.

Reserved names, no records yet:

- `view.pcbjs.dev`: a hosted viewer that opens a board from a URL or a dropped `board.json`, without installing pcbjs.
- `play.pcbjs.dev`: a playground that edits and compiles a board in the browser, with the viewer beside the code.

## Versioned docs, later

pcbjs.dev holds the docs of the last release and pcbjs.dev/next/ those of `main`. When 0.1 ships and 0.2 starts to differ, each minor gets a frozen copy under its own path:

- In `pages.yml`, build the newest tag of each minor into `/0.1/` and so on, with `PCBJS_SITE_BASE=/0.1/`, beside the stable and next trees in the same artifact.
- Add a version menu to the nav, an item per minor linking to `/0.1/` and so on, with the root labelled as the latest release and a link to `/next/` for `main`.
- Point `pcbjs docs` of a released package at its minor in its output, since the terminal docs are already versioned by the installed package.
