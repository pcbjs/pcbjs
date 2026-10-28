# The pcbjs docs site

The VitePress project behind https://pcbjs.dev, built from `main`, with the docs of the last published train at https://pcbjs.dev/stable/. It renders the topic files in `docs/` where they are, the same files `pcbjs docs` prints, and adds its own pages beside them.

## Commands

From the repository root, after `npm install` and `npm run build`:

```sh
npm run docs:dev        # the gallery data and SVGs, then the site with hot reload on http://localhost:5173; add -- --port <n> for another port
npm run docs:build      # the gallery data and SVGs, then the site in site/.vitepress/dist
npm run docs:preview    # serve the built site; add -- --port <n> for another port
```

## What is where

| Path | What |
| --- | --- |
| `.vitepress/config.mts` | the site config: nav, search, themes, the brand slot, the edit links |
| `.vitepress/topics.ts` | reads `docs/*.md`: titles, the two-line summary as the page description, the sidebar groups, the README's For agents section and the changelog |
| `docs/[topic].md`, `docs/[topic].paths.ts` | one page per topic file at `/docs/<topic>`, a dynamic route over `docs/`, so nothing is copied |
| `[page].md`, `[page].paths.ts` | `/agents` from the README's For agents section, `/changelog` from `CHANGELOG.md`, else `packages/pcbjs/CHANGELOG.md` |
| `index.md`, `getting-started.md`, `why.md`, `examples.md` | the site's own pages; their `tsx` samples are type checked by `packages/pcbjs/tests/site-samples.test.mjs` |
| `.vitepress/theme/HomePage.vue`, `home.data.ts` | the home page, which `index.md` mounts: the headline, the install command, the Blinky demo, five rows of snippet and result, the footer links; its code and map come from `.gallery/home.json` |
| `.vitepress/theme/MapDemo.vue` | the Blinky demo: the layout's source beside its board and schematic; hovering a source range lights what it drew and hovering an item lights its innermost range, a click pins, a chip names the item, and a tour cycles through a few ranges every two seconds until the first hover; it touches the DOM only from `onMounted` |
| `demos/` | a project of four small boards, one per home page row: `route`, `pour`, `drc` with a deliberate clearance error, and `divider` with its schematic; each shows its `#region show` |
| `examples.data.ts`, `.vitepress/theme/Gallery.vue` | the gallery: one card per board under `examples/`, its text the first sentence of its row in `examples/README.md` and of the entry's first comment |
| `scripts/boards.mjs`, `scripts/compile.mjs` | compile every example project and `demos/` once, as `pcbjs check` does, and write `boards.json` with its numbers and each board's 2D view and schematic as SVG; no Chrome and no raster |
| `scripts/highlight.mjs` | Shiki at build time in the site's `github-light` and `github-dark` themes, a class per colour pair; with ranges, each source range becomes a `<span data-r>` around its text, nested as the ranges nest |
| home page map | `compile.mjs --map blinky.pcb.tsx` keeps `data-id`, `data-ref` and `data-pad` on that board's SVG items and `data-ref` on its schematic symbols, and writes the compiler's source index for the file, each range with its item ids, part refs and a chip such as `route VCC · H 9`, plus the fab file list; `boards.mjs` turns it into `home.json`: the highlighted region, the ranges' ids, refs and chips, the tour, each demo's snippet and the CSS of the token colours |
| `.vitepress/theme/BoardSvg.vue` | inlines one of those SVGs through `@zhangyx1998/svg-loader`, which makes each a style-scoped Vue component in its own chunk, in a box of the SVG's aspect ratio; with `lazy`, as in the gallery and the home page rows, the page holds only the box and the SVG loads when it nears the viewport; Blinky's board and schematic in the home page demo are inlined in the HTML; `aspects.data.ts` gives each box its ratio |
| `.gallery/` | what `boards.mjs` wrote, untracked; `docs:build` and `docs:dev` run it first, and nothing is committed in its place |
| `brand/` | `logo.svg` and `favicon.svg`, the nav logo and the favicon when the files exist, and `og.png`, the Open Graph image |

A new topic file in `docs/` becomes a page on the next build. Put it in a sidebar group in `groups` in `.vitepress/topics.ts`; a topic in no group lands in Background. Topic files keep their plain style for the terminal: a mention such as `board.md` in prose becomes a link on the site, and the page is wrapped in `v-pre`, so `{{` in a sample is safe.

## Deployment

`.github/workflows/pages.yml` builds both trees into one GitHub Pages artifact of `pcbjs/pcbjs`, since every deploy replaces the whole site, and deploys it with `actions/deploy-pages` under the workflow's own token; no secret and no other repository. It runs on a push to `main` that touches `docs/`, `site/`, `examples/`, `README.md` or the workflow, by hand with Run workflow, and from `release.yml` after a publish; a push of the packages alone builds nothing.

| Path | Tree | Built from |
| --- | --- | --- |
| https://pcbjs.dev/ | the site and docs of `main` | `main`, every push that touches the site |
| https://pcbjs.dev/stable/ | the docs of the last published train | the tag, with `PCBJS_SITE_BASE=/stable/` and a `noindex` robots meta; `/next/` redirects to the root |

Each tree runs `npm ci`, `npm run build` and `npm run docs:build -- --outDir <dir>` on ubuntu-latest, and the workflow keeps the built stable tree in the Actions cache by its tag and builds a train only once, and keeps `site/.gallery` and the examples' route files of `main` by content, which a new train reuses when nothing under `packages/`, `examples/` or `site/scripts/` differs from `main`. `scripts/boards.mjs` keeps a project's numbers and SVGs while its folder and the packages hash the same, versions left out, so a docs-only push compiles nothing and an example edit compiles only that project. The SVGs take their colours from CSS variables, `--pcb-*` from `boardSvg(board, { vars: true })` and `--sch-*` from the schematic style, which `.vitepress/theme/custom.css` and `config.mts` set for the light theme and for VitePress's `.dark`. `PCBJS_SITE_URL` sets the host in the sitemap, the canonical links and the Open Graph tags, `https://pcbjs.dev` by default; `PCBJS_SITE_BASE` sets the VitePress `base`, `/` by default, and any other base adds the `noindex` meta. The workflow writes `CNAME` and `.nojekyll` at the artifact root.

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

pcbjs.dev holds the docs of `main` and pcbjs.dev/stable/ those of the last release. When 0.1 ships and 0.2 starts to differ, each minor gets a frozen copy under its own path:

- In `pages.yml`, build the newest tag of each minor into `/0.1/` and so on, with `PCBJS_SITE_BASE=/0.1/`, beside the stable and next trees in the same artifact.
- Add a version menu to the nav, an item per minor linking to `/0.1/` and so on, with the root labelled as `main` and `/stable/` as the latest release.
- Point `pcbjs docs` of a released package at its minor in its output, since the terminal docs are already versioned by the installed package.
