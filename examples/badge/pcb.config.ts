import { defineConfig } from '@pcbjs/core'

// Project settings shared by every board in this directory. The board itself, its size, fab and parts, is in pcb.tsx.
export default defineConfig({
  entries: ['pcb.tsx'], // the boards; every pcbjs command reads them, globs such as 'boards/*.tsx' allowed
  editor: { follow: 'meta-click' }, // a plain click in the viewer only selects; cmd+click opens the source
  // base: '/my-board/',                 // the URL path the built site is served under, default "/"
  // repo: 'https://github.com/me/board', // link the built site's items to their source lines
})
