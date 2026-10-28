// Blinky, the sourcing: part numbers for J1, the resistors and C1, kept out of the schematic. pcb.tsx imports this module.
// MPN is the catch-all; an MPN:<tag> key wins on a target whose sourcing tags name it, such as LCSC on JLCPCB or US on OSH Park.
import { source } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
import { J1, C1 } from './blinky.sch'

// every 330 Ω 0603 resistor on the board: the resistor of each channel
source(R0603, '330', { MPN: 'RC0603FR-07330RL', 'MPN:US': 'ERJ-3EKF3300V', 'MPN:LCSC': 'C23138' })

// one part at a time
source(C1, { MPN: 'CL10B104KB8NNNC', 'MPN:US': 'C0603C104K5RACTU', 'MPN:LCSC': 'C14663' })
source(J1, { MPN: 'PEC03SAAN', Manufacturer: 'Sullins', 'MPN:DigiKey': 'S1011EC-03-ND' })
