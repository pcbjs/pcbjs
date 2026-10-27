# led-matrix

A pcbjs board. The design is `pcb.tsx`, project settings are in `pcb.config.ts`.

```sh
npm install
npm run dev       # live viewer on http://localhost:5173, updates on every save
npm run build     # fab files in .pcbjs/fab/led-matrix, static site in .pcbjs/dist
npm run preview   # serve the built site
```

`npm run build` prints the DRC and ERC summary and fails when the board has errors or unconnected nets. The fab zip in `.pcbjs/fab/led-matrix` is what you upload to the fab.

To grow the board, add nets and parts at the top of `pcb.tsx` and place them below. When the schematic outgrows one file, move the nets and parts to `board.sch.ts` and the part numbers to `board.sourcing.ts`, and import them from `pcb.tsx`.
