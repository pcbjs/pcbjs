// the viewer's loading screen files, which esbuild bundles as text
declare module '*.css' {
  const text: string;
  export default text;
}
declare module '*.svg' {
  const text: string;
  export default text;
}
