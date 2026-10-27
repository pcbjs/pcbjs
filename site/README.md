# The pcbjs docs site

The VitePress project behind https://pcbjs.dev, with the docs of `main` at https://next.pcbjs.dev. It renders the topic files in `docs/` where they are, the same files `pcbjs docs` prints, and adds its own pages beside them.

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
| `public/CNAME`, `public/.nojekyll` | copied into every build; the CNAME says `pcbjs.dev` and the workflows overwrite it per target |

A new topic file in `docs/` becomes a page on the next build. Put it in a sidebar group in `groups` in `.vitepress/topics.ts`; a topic in no group lands in Background. Topic files keep their plain style for the terminal: a mention such as `board.md` in prose becomes a link on the site, and the page is wrapped in `v-pre`, so `{{` in a sample is safe.

## Deployment

Two targets, each its own repository with its own deploy key, so no key can write to both:

| Site | Repository | Workflow | When | Secret |
| --- | --- | --- | --- | --- |
| https://pcbjs.dev | `pcbjs/pcbjs.github.io` | `release.yml`, job `site` | after a publish that released packages, and by hand with Run workflow, which takes a ref | `PAGES_DEPLOY_KEY` |
| https://next.pcbjs.dev | `pcbjs/next.pcbjs.dev` | `docs.yml` | every push to `main`, and by hand | `NEXT_PAGES_DEPLOY_KEY` |

Both run `npm ci`, `npm run build` and `npm run docs:build` on ubuntu-latest, which has Chrome, write the target's host into `dist/CNAME`, and push `site/.vitepress/dist` to the `main` branch of the target with `peaceiris/actions-gh-pages`. `PCBJS_SITE_URL` sets the host in the sitemap, the canonical links and the Open Graph tags; it defaults to `https://pcbjs.dev`.

### One-time setup, per repository

Do this once for `pcbjs/pcbjs.github.io` with the secret `PAGES_DEPLOY_KEY` and the domain `pcbjs.dev`, and once for `pcbjs/next.pcbjs.dev` with `NEXT_PAGES_DEPLOY_KEY` and `next.pcbjs.dev`.

1. Create the public repository with a `main` branch; an empty initial commit is enough.
2. Make a deploy key pair on your machine, with no passphrase, outside any repository: `ssh-keygen -t ed25519 -C "pcbjs site deploy" -N "" -f site-deploy`.
3. In the site repository, Settings, Deploy keys, Add deploy key: paste `site-deploy.pub`, title it `site deploy from pcbjs/pcbjs`, and tick Allow write access.
4. In `pcbjs/pcbjs`, Settings, Secrets and variables, Actions, New repository secret: the secret name above, and the whole private key file `site-deploy`, header and footer lines included.
5. Delete both key files from your machine.
6. In the site repository, Settings, Pages: Source Deploy from a branch, branch `main`, folder `/ (root)`.
7. Run the workflow once, then in Settings, Pages, Custom domain enter the domain above and Save; GitHub checks the DNS records below.
8. When the certificate is issued, tick Enforce HTTPS.

To rotate a key, repeat steps 2 to 5 for that repository and remove the old deploy key.

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
| `next` | `CNAME` | `pcbjs.github.io` |

- `next` points at the organisation host too; GitHub serves `pcbjs/next.pcbjs.dev` there because that repository claims `next.pcbjs.dev` in its Pages custom domain.
- `www.pcbjs.dev` redirects to `pcbjs.dev` once `pcbjs.dev` is the custom domain of `pcbjs/pcbjs.github.io`; nothing else is needed for it.
- Verify the domain for the organisation, Settings, Pages, Add a domain, with the `TXT` record GitHub shows, so no other account can claim a subdomain.
- `.dev` is on the HSTS preload list, so browsers only ever load the site over HTTPS; until the certificate is issued the site does not open.
- Check with `dig +short pcbjs.dev A`, `dig +short pcbjs.dev AAAA` and `dig +short next.pcbjs.dev CNAME`.

Reserved names, no records yet:

- `view.pcbjs.dev`: a hosted viewer that opens a board from a URL or a dropped `board.json`, without installing pcbjs.
- `play.pcbjs.dev`: a playground that edits and compiles a board in the browser, with the viewer beside the code.

## Versioned docs, later

pcbjs.dev holds the docs of the last release and next.pcbjs.dev those of `main`. When 0.1 ships and 0.2 starts to differ, each minor gets a frozen copy under its own path:

- Add a `release-docs` job, run on a `v0.1.*` tag, that checks the tag out, builds with `base: '/0.1/'` passed through an environment variable read in `config.mts`, and deploys with `peaceiris/actions-gh-pages` using `destination_dir: 0.1` and `keep_files: true`, so the root build and the other minors stay.
- Make the stable deploy in `release.yml` keep the minor folders: `keep_files: true` instead of `force_orphan: true`.
- Add a version menu to the nav, an item per minor linking to `/0.1/` and so on, with the root labelled as the latest release and a link to next.pcbjs.dev for `main`.
- Point `pcbjs docs` of a released package at its minor in its output, since the terminal docs are already versioned by the installed package.
