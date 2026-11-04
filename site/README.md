# The pcbjs docs site

The VitePress project behind https://pcbjs.dev, built from `main`, with the docs of the last published train at https://pcbjs.dev/stable/. It renders the topic files in `docs/` where they are, the same files `pcbjs docs` prints, and adds its own pages beside them.

## Commands

From the repository root, after `npm install` and `npm run build`:

```sh
npm run docs:dev        # demo data, then hot reload on http://localhost:8080 and LAN; add -- --port <n> for another port
npm run docs:build      # the same, then the site in site/.vitepress/dist, printing its size by kind of file and its build time
npm run docs:preview    # serve the built site; add -- --port <n> for another port
npm run docs:test       # the built site: module facets and the pages in a headless Chromium
```

The development server listens on all interfaces at port 8080 and fails if that port is occupied. The existing Cloudflare Access-protected tunnel at `https://dev.z-yx.net` forwards to `http://localhost:8080`; that hostname is explicitly allowed by Vite. Local review pages are included in this development server. Production builds continue to exclude them.

## What is where

| Path | What |
| --- | --- |
| `.vitepress/config.mts` | the site config: nav, search, themes, the brand slot, the edit links, `pcbjs({ boards: 'compile' })` and `virtual:site-boards`, the `?pcb:board` ref of every board by page id; code tokens as classes in a build |
| `.vitepress/topics.ts` | reads `docs/*.md`: titles, the two-line summary as the page description, the sidebar, Basics and Advanced, the README's For agents section and the changelog |
| `docs/[topic].md`, `docs/[topic].paths.ts` | one page per topic file at `/docs/<topic>`, a dynamic route over `docs/`, so nothing is copied |
| `[page].md`, `[page].paths.ts` | `/agents` from the README's For agents section, `/changelog` from `CHANGELOG.md`, else `packages/pcbjs/CHANGELOG.md` |
| `guide/`, `.vitepress/guide.ts` | Getting started and Advanced lessons, their landing pages and sidebar order; `GuideDemo.vue` pairs complete source modules with independently compiled lesson states |
| `local/[page].md`, `local/[page].paths.ts`, `scripts/local-docs.mjs` | development-only native routes over Git-ignored `docs/local/`, with optional `docs/local/config.ts` labels and newest-first order |
| `index.md`, `getting-started.md`, `why.md`, `examples.md`, `features.md` | the site's own pages; their `tsx` samples are type checked by `packages/pcbjs/tests/site-samples.test.mjs` |
| `boards.ts` | every entry of each project under `examples/` and of `demos/`, compiled once per build in Node through `resolveBoard()` for the numbers a page prints before any script runs: name, views, DRC and ERC counts; a board that does not compile is left out with one line, as `library/consumer` is until `scripts/check-examples.mjs` installs its library |
| `.vitepress/theme/LiveBoard.vue` | one board in a page: its poster, then `View3D`, `View2D` or `SchView` of `@pcbjs/ui` once the box nears the viewport, which starts the board's compile in the reader's browser; the poster fades when the view is drawn and stays when the compile fails; at most six 3D views live, the oldest away from the viewport dropped first |
| `.vitepress/theme/HomePage.vue`, `home.data.ts` | the home page, which `index.md` mounts: the headline, the install command, the Blinky demo, one row per key card of the catalogue with its snippet and live board, the footer links; its code, map and snippets come from `.gallery/home.json` |
| `.vitepress/theme/MapDemo.vue` | the Blinky demo: the layout's source beside its board, schematic and 3D view; hovering a source range lights what it drew and hovering an item lights its innermost range, a click pins, a chip names the item, and a tour cycles through a few ranges every two seconds until the first hover; it touches the DOM only from `onMounted` |
| `.vitepress/theme/BoardSvg.vue` | the demo's board and schematic inlined through `@zhangyx1998/svg-loader`, their items keeping their ids and refs for the map, themed by the site's CSS variables |
| `features/`, `features.data.ts`, `scripts/features.mjs`, `.vitepress/theme/Features.vue` | the feature catalogue, its loader and `/features`, below |
| `demos/` | a project of four small boards, fixtures of key cards: `route`, `pour`, `drc` with a deliberate clearance error, and `divider` with its schematic; each shows its `#region show` |
| `examples.data.ts`, `.vitepress/theme/Gallery.vue` | the gallery: one card per board under `examples/`, the boards of the README's Basic table first, a divider, then each other project in the order of its Advanced table; 3D first, its tabs, its DRC and ERC pills and the first sentence of its row in `examples/README.md` and of the entry's first comment |
| `examples/[board].md`, `.vitepress/theme/BoardPage.vue` | `/examples/<id>`, one board filling the window: `PcbViewer` with its rails, findings, BOM and nets, the pills, the view tabs and a Source link to the entry on GitHub |
| `scripts/boards.mjs`, `scripts/compile.mjs` | the home page demo: Blinky compiled as `pcbjs check` does into its board and schematic SVGs with `data-id`, `data-ref` and `data-pad` kept, and the compiler's source index for the file with a chip per range such as `route VCC · H 9`, turned into `.gallery/home.json` with each feature's snippet and the CSS of the token colours; kept while Blinky's project, the scripts and the packages hash the same |
| `scripts/highlight.mjs` | Shiki at build time in the site's `github-light` and `github-dark` themes, a class per colour pair; with ranges, each source range becomes a `<span data-r>` around its text, nested as the ranges nest |
| `scripts/measure.mjs`, `tests/` | the built site's total, largest asset and size by category; the tests check every board's module facet and files, shared syntax styles, and in the Chromium of `scripts/browser-equality.mjs` the posters without JavaScript and the live views with it |
| `.gallery/` | what `boards.mjs` wrote, untracked; `docs:build` and `docs:dev` run it first, and nothing is committed in its place |
| `brand/` | `logo.svg` and `favicon.svg`, the nav logo and the favicon when the files exist, and `og.png`, the Open Graph image |

## The feature catalogue

The gallery at `/features` is the source of truth for what pcbjs does: one file per feature, `features/<category>/<id>.md`, the category one of `design`, `routing`, `checks`, `output`, `editor`, `agents` and `tooling`, the id the file name. Its frontmatter is one `key: value` per line and the paragraph after it the one-sentence summary:

```md
---
title: Pours, thermals and islands
status: beta
docs: pours
fixture: site/demos/pour.pcb.tsx
view: 3d
flag: pour(net, layer, area)
evidence: Thermal relief gaps are 16-sided polygons, not round.
snippet: site/demos/pour.pcb.tsx
key: true
---

Pours fill around other copper, join their pads through thermal spokes and drop islands.
```

| Field | What |
| --- | --- |
| `title` | the card's heading |
| `status` | `shipped`, `beta` while a gap is still open, or `planned`, the roadmap, which carries its title and nothing else |
| `docs` | the topic under `docs/` the card links to |
| `fixture`, `view` | the entry, from the repository root, whose board the card shows, and its view: `2d`, `3d` or `sch` |
| `flag` | the element, call, command or flag to remember it by |
| `evidence` | the test that covers a shipped feature, or the gap a beta one still has, in one sentence |
| `snippet` | optional: a file whose `#region show` a key card prints beside its board |
| `key` | optional: `true` puts the card on the home page, at least one per category |

`scripts/features.mjs` reads the catalogue and checks it; `features.data.ts` runs that check against the boards `boards.ts` compiled, so a build fails on a topic `docs/` lacks, a fixture that does not exist, a fixture no board was compiled from, a view the board lacks, or a shipped feature's evidence file that is missing. `node site/scripts/features.mjs --write` writes `docs/support.md`, the supported, partial and missing matrix, from the statuses and evidence; `tests/features.test.mjs` fails when it differs, when a docs topic with a Basic or Advanced marker is claimed by no feature, and checks the home page's key cards, `/features` and the examples order in the built site.

## Boards in the page

Every board is a `?pcb:board` import of `@pcbjs/cli/vite` in compile mode, docs/ui.md: the build ships each board's poster, the project's design modules and route memos, the pcbjs packages once and each mesh once, and the reader's browser compiles a board when its box nears the viewport. A page without JavaScript shows the posters; the full page and the cards keep the poster when a compile fails. The schematic tab has no poster and waits for the compile, and boards placed by `reference()` show without the referenced board, whose mesh is too large for the budget.

A new topic file in `docs/` becomes a page on the next build. The `Basic.` or `Advanced.` that starts the second line of its summary picks its sidebar group; Basics follow the README's Basics table and Advanced the sections of `docs/advanced.md`, a Basic topic in neither at the end of Basics and an Advanced one under More. Topic files keep their plain style for the terminal: a mention such as `board.md` in prose becomes a link on the site, and inline code holding `{{` becomes `<code v-pre>`, so a sample is safe while the rest compiles to static HTML, which the lean page chunks leave out.

## Deployment

`.github/workflows/pages.yml` builds both trees into one GitHub Pages artifact of `pcbjs/pcbjs`, since every deploy replaces the whole site, and deploys it with `actions/deploy-pages` under the workflow's own token; no secret and no other repository. It runs on a push to `main` that touches `docs/`, `site/`, `examples/`, `README.md` or the workflow, by hand with Run workflow, and from `release.yml` after a publish; a push of the packages alone builds nothing.

| Path | Tree | Built from |
| --- | --- | --- |
| https://pcbjs.dev/ | the site and docs of `main` | `main`, every push that touches the site |
| https://pcbjs.dev/stable/ | the docs of the last published train | the tag, with `PCBJS_SITE_BASE=/stable/` and a `noindex` robots meta; `/next/` redirects to the root |

Each tree runs `npm ci`, `npm run build` and `npm run docs:build -- --outDir <dir>` on ubuntu-latest, then main's tree runs `npm run docs:test` against it. The workflow keeps the built stable tree in the Actions cache by its tag and builds a train only once, and keeps `site/.gallery` and the stage caches, route memos and meshes under each example's `.pcbjs` of `main` by content, which a new train reuses when nothing under `packages/`, `examples/` or `site/scripts/` differs from `main`; the stage cache keys every stage on its inputs, so a docs-only push compiles nothing and an example edit compiles only that project. The demo's SVGs take their colours from CSS variables, `--pcb-*` from `boardSvg(board, { vars: true })` and `--sch-*` from the schematic style, which `.vitepress/theme/custom.css` and `config.mts` set for the light theme and for VitePress's `.dark`; the posters are pictures in the board's own colours. `PCBJS_SITE_URL` sets the host in the sitemap, the canonical links and the Open Graph tags, `https://pcbjs.dev` by default; `PCBJS_SITE_BASE` sets the VitePress `base`, `/` by default, and any other base adds the `noindex` meta. The workflow writes `CNAME` and `.nojekyll` at the artifact root.

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

## Local workspace documentation

The Guide at `/guide/getting-started/` has a shared learning sidebar with Getting started and Advanced sections; `/docs/` keeps the full reference sidebar. The older `/getting-started` page points to the new walkthrough. The Local section uses native VitePress pages, sidebar, outline and mobile navigation.

Keep internal reports in **`docs/local/`**, which Git ignores in its entirety, including its optional `config.ts`. During `docs:dev`, a **🗂️ Local** nav item appears only when that directory contains at least one nonempty Markdown file. `/local/` lists those documents newest first. Changes to documents or config restart the development site to update both routes and navigation. Do not use `site/local/` for report content: it contains only the tracked dynamic route implementation.

To add a revision:

1. Create `docs/local/YYYY-MM-DD-short-title.md` with an H1 and the completion/review date. Keep original issue numbers when grouping related work. Use ✅ for verified changes, 📝 for decisions and 🔎 for remaining limitations; include concise verification evidence.
2. Optionally create or extend `docs/local/config.ts` to give documents shorter sidebar labels or override their dates. Unlisted Markdown files are still discovered. Dates use `YYYY-MM-DD`; date groups sort newest first; within a date, config order puts the latest report first, followed by unlisted filenames descending. Undated documents follow dated ones.
3. Open `/local/` with `npm run docs:dev`. Use relative Markdown links between reports. Never force-add the ignored directory, copy its contents into public assets, or link to local reports from public pages.

Example `docs/local/config.ts`:

```ts
export default {
  items: [
    { file: '2026-11-03-navigation.md', text: '🧭 Navigation review', date: '2026-11-03' },
    { file: '2026-11-02-first-batch.md', text: '✅ First batch', date: '2026-11-02' },
  ],
}
```

Reusable infrastructure and this contributor convention are tracked. Private content and local config are not. Production builds exclude `site/local/**`, skip local config evaluation, and omit Local navigation, pages, search entries and sitemap URLs. Local responses use `no-store` and `noindex,nofollow`; pages have no GitHub edit link. `tests/local-report.test.mjs` checks discovery, ordering, production isolation and headers, and scans the built artifact. This convention applies to subsequent revision rounds and other contributors.

## Guide examples

The Guide contains Quickstart, npm setup, agent setup, extension setup and the Blinky walkthrough. Advanced groups focused pages under reusable design, precision placement, routing and copper, and inspection and delivery. `.vitepress/guide.ts` owns the sidebar order. Keep page titles unnumbered. The old `/docs/quickstart` URL is a compatibility pointer, excluded from the reference sidebar.

`GuideDemo.vue` displays complete project files with only the lesson's relevant lines highlighted. Source hover, click-to-pin, arrow-key navigation and drawing hover use compiler source identities. The 2D and schematic drawings are compiled SVGs; 3D lazily compiles the same source graph in the browser. Examples never borrow the homepage board. Source text is pooled across repeated steps, and the component loads only on pages that use it.

To add a complete single-file board example, use a fence such as `tsx {10-12} preview=my-example`. The ordinary VitePress line ranges mark the lesson focus. The fence must include imports, declarations and a default-exported PCB. `guide-examples.mjs` reads it, and `guideFences` replaces its presentation with the matching source/preview component. The CLI still prints the original code fence. Configuration and shell commands remain ordinary code blocks, not fabricated board previews. Reference fragments remain API illustrations; link to a complete guide example when a fragment needs a surrounding design.

Blinky uses `<GuideDemo example="blinky-placement" />` and the other named states in `guide-examples.mjs`. Each state has complete source files derived from the shipped template. Outline-only and three-part placement states exclude later declarations, placements and copper. The schematic introduction inspects the supplied placement layout and offers schematic view only; the next lesson starts the new outline. The compiler currently rejects declared-but-unplaced ordinary board parts, so each progressive layout declares only its placed subset. Do not hide later items with CSS or insert unseen placements merely to make a sample compile.

`guide-compile.mjs` compiles each example in an isolated process and records actual geometry, finding counts and source identities. `guide-data.mjs` caches by source and compiler inputs; a failed example fails the docs build. Generated projects and snapshots live under ignored `.gallery/guide/`. Do not edit them. `guide.test.mjs` proves source parity, progressive part/route counts, identity validity and clean completed examples. `guide-browser.test.mjs` checks selection, keyboard navigation, 3D compilation and narrow-screen layout without computer use. Run those tests and the site/reference sample checks after editing examples.

There is no fixed artifact-size gate. Builds report the total, largest asset and category breakdown through `scripts/measure.mjs`. The current site is approximately 20 MB, including independent tutorial states, design sources, meshes and the compiler runtime. Review growth alongside its user benefit: share repeated styles and source data, keep 3D loading lazy, and avoid shipping duplicate generated assets. Record material size changes in the review report; do not reduce useful examples merely to hit a total-byte target.

The Local sidebar and index group documents by date, newest date first, with dates on group headings rather than document titles. Keep titles and config labels free of date prefixes. Reports with the same date follow their order in `docs/local/config.ts`; insert the latest report first. Unlisted files retain filename ordering within their date. Keep dated filenames and existing links stable; a long-lived tracker may use a stable filename and an explicit config date.

## Development ownership

`/development/` contains six contract sections: Architecture, Syntax and semantics, Interfaces, Exchange formats, Communication protocols and User interaction protocols. Its overviews establish scope, invariants, authoritative declarations and evidence boundaries. Conformance and compatibility has its own page. The sidebar and detailed-topic ownership come from `scripts/development.mjs`; a topic has exactly one owner.

Detailed pages read the existing `docs/<topic>.md` directly through `developmentPaths()`. Keep those files authoritative for both the website and `pcbjs docs`; do not copy their bodies into a second Markdown tree. Dedicated overview and format pages live under `site/development/`. Their source/edit links must point to actual definitions and their own source location respectively.

Moved `/docs/<topic>` pages are small compatibility pages with a canonical destination, no search entry and a no-JavaScript link. `DocRedirect.vue` preserves the query and section fragment when redirecting in a browser. Canonical links between documentation topics are rewritten outside code fences. Keep section anchors stable and check existing bookmarks when changing headings. Reference retains command/setup/workflow topics; Guide retains progressive learning.

To add a contract, select its owning section, add a topic to the manifest or a dedicated static page to that section's `pages`, and describe inputs, output, side effects, failure and compatibility. Link shared field definitions rather than maintaining independent schemas without a generation/checking path. Do not label an inventory entry as runtime-verified without acceptance evidence. Run `site/tests/development.test.mjs`, the browser navigation test, sample checks and a production build after structural changes. The production build must still exclude `docs/local/`.

The section is named **Development** and uses `/development/`. Older `/specifications/` URLs are lightweight compatibility redirects emitted by `developmentRedirects`; they preserve query strings and anchors, are excluded from search/sitemap, and have no duplicate VitePress page bundles. The development server supplies the same redirects. The six contract categories remain unchanged.
