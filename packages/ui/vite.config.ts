// the library build: the ESM entries, all of it and each view alone, sharing chunks, with the 3D view's three.js a chunk of its own and one
// style.css, and the generated models for Node; vue, three and @pcbjs/core stay imports
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const external = [/^vue($|\/)/, /^three($|\/)/, /^@pcbjs\/core($|\/)/]

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      // one entry per view, so a page loading one carries no other view; they share their chunks
      entry: {
        index: 'src/index.ts',
        view2d: 'src/entries/view2d.ts',
        view3d: 'src/entries/view3d.ts',
        sch: 'src/entries/sch.ts',
        checks: 'src/entries/checks.ts',
        panels: 'src/entries/panels.ts',
        models: 'src/models/index.ts',
      },
      formats: ['es'],
      fileName: (_, name) => `${name}.js`,
      cssFileName: 'style',
    },
    outDir: 'dist',
    target: 'es2022',
    minify: false,
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: { external: id => external.some(r => r.test(id)) },
  },
})
