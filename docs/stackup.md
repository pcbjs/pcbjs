# Stackup and defaults

The stackup a board is built on, its builders and fab stackups, and the project-wide defaults every `<PCB>` starts from.
Advanced. The `<PCB>` props are in board.md; why each value is what it is, with its source, in stackup-and-rules.md.

```tsx
import PCB from '@pcbjs/core'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'

export default <PCB name="Quad" rev="0.1.0" stackup={JLCPCB_4L_7628}>{/* … */}</PCB>
```

## Stackup

`stackup` on `<PCB>`, a preset, a variant target or `defineDefaultBoard`; the default is `twoLayer()`, 1.6 mm.

```ts
interface Stackup {
  layers: StackupLayer[]   // top to bottom
  finish?: 'HASL' | 'LeadFreeHASL' | 'ENIG' | 'ImmersionSilver' | 'ImmersionTin' | 'OSP' | 'HardGold'
  maskColor?: string
  silkColor?: string
  thickness?: number       // nominal ordered thickness; default the sum of the layers
}

type StackupLayer =
  | { type: 'copper'; name: 'F.Cu' | 'B.Cu' | `In${number}.Cu`; thickness: number; weight?: number }
  | { type: 'core' | 'prepreg'; material?: string; thickness: number; er?: number; lossTangent?: number }
  | { type: 'mask' | 'silk' | 'paste'; side: 'F' | 'B'; thickness?: number }
```

Thicknesses in mm, `weight` in oz copper with 1 oz = 0.035 mm, the copper thickness `.current()` sizes against, routing.md, `er` the dielectric constant, `maskColor` and `silkColor` the colours of both sides. The compiled board always holds one in `board.stackup`; it goes into the Gerber job file and README-fab and colours the 3D view.

| From `@pcbjs/lib/stackups` | What |
| --- | --- |
| `twoLayer`, `fourLayer`, `sixLayer`, `eightLayer` | take `thickness`, `outerCopper`, `innerCopper` in oz, `prepreg` in mm, `finish`, `maskColor`, `silkColor`, `material`, `er`, `lossTangent`; defaults 1.6 mm, 1 oz outer, 0.5 oz inner, FR4 at er 4.5, green mask, white legend |
| `JLCPCB_2L`, `JLCPCB_4L_7628`, `OSHPARK_2L`, `OSHPARK_4L` | frozen fab stackups; spread into a new object to change |

A compile error names the layer unless:

- copper runs F.Cu, In1.Cu and on, B.Cu, with 2, 4, 6 or 8 layers;
- a core or prepreg sits between every two copper layers;
- front mask, silk and paste sit above F.Cu, back ones below B.Cu;
- a nominal `thickness` is within 10% of the sum of the layers.

stackup-and-rules.md has the builders' layer tables and every preset's source.

## Defaults

```ts
// pcb.config.ts
import { defineConfig, defineDefaultBoard } from '@pcbjs/core'
import { JLCPCB } from '@pcbjs/lib/rules'
import { JLCPCB_4L_7628 } from '@pcbjs/lib/stackups'

defineDefaultBoard({ stackup: JLCPCB_4L_7628, rev: 'A', rules: JLCPCB })

export default defineConfig({})
```

Levels, lowest first; a higher level wins:

1. `BASE_BOARD`: `twoLayer()`, 1.6 mm, rev `""`, the `BASE` rules of `@pcbjs/lib/rules`, base autoroute parameters, no net classes.
2. `defineDefaultBoard`.
3. A fab preset or variant target.
4. The props of `<PCB>`.

`rules` and `autoroute` merge key by key, `classes` by class then field. The highest level giving a `stackup` decides the layers and the thickness.

| Call | Does |
| --- | --- |
| `defineDefaultBoard(spec)` | every `<PCB>` prop but `name`, `children` and `fonts`, the rules included; replaces the earlier default, returns it resolved and frozen; throws on an invalid stackup |
| `resetDefaults()` | clears it |
| `BASE_BOARD` | the frozen base level |

A second call replaces the first; spread the returned value to build on it. The registry is one per Node process, so call them in `pcb.config.ts` or a module every entry imports.
