# Hello

A pcbjs board. The design is `pcb.tsx`, project settings are in `pcb.config.ts`.

```sh
npm install
npx pcbjs check   # board checks and TypeScript; run before building fab files
npm run dev       # live viewer on http://localhost:5173, updates on every save
npm run build     # fab files in .pcbjs/fab/Hello, static site in .pcbjs/dist
npm run preview   # serve the built site
```

After `npx pcbjs check` passes, `npm run build` writes the fab files and site with DRC, ERC and a Gerber self-check. Build does not run TypeScript checking. Before uploading the zip in `.pcbjs/fab/Hello`, read its `README-fab.txt` and independently review the circuit and fabrication outputs, including drills, mask, paste and placement.

To grow the board, add nets and parts at the top of `pcb.tsx` and place them below. When the schematic outgrows one file, move the nets and parts to `board.sch.ts` and the part numbers to `board.sourcing.ts`, and import them from `pcb.tsx`.
