// Blinky, the sourcing: part numbers for J1, the resistors and C1, kept out of the schematic. blinky.pcb.tsx imports this module.
// MPN is the catch-all; an MPN:<tag> key wins on a target whose sourcing tags name it, such as LCSC on JLCPCB or US on OSH Park.
import { J1, C1, CH1, CH2, CH3 } from './blinky.sch'

// the 330 Ω 0603 resistor of each channel
for (const ch of [CH1, CH2, CH3]) ch.R.source({ MPN: 'RC0603FR-07330RL', 'MPN:US': 'ERJ-3EKF3300V', 'MPN:LCSC': 'C23138' })

// one part at a time
C1.source({ MPN: 'CL10B104KB8NNNC', 'MPN:US': 'C0603C104K5RACTU', 'MPN:LCSC': 'C14663' })
J1.source({ MPN: 'PEC03SAAN', Manufacturer: 'Sullins', 'MPN:DigiKey': 'S1011EC-03-ND' })
