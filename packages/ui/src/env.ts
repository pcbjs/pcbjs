// what the app's bundler knows and a prebuilt library cannot: the site's base URL and dev mode, set by the app before it mounts
export const env = { base: '/', dev: false }

/** Tell the library the site's base URL and whether it runs under a dev server, as `import.meta.env` gives them to the app. */
export function configure(o: { base?: string; dev?: boolean }): void {
  if (o.base !== undefined) env.base = o.base
  if (o.dev !== undefined) env.dev = o.dev
}
