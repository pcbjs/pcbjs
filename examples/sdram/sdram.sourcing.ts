// Part numbers for the passives of sdram: MPN is the catch-all, MPN:LCSC what JLCPCB assembles.
import { C_IN, C_OUT, C_X1, C_X2, C_RST, C_MCU, C_RAM, C_VCAP1, C_VCAP2, R_CC1, R_CC2, R_BOOT } from './sdram.sch'

const C0603_100N = { MPN: 'CL10B104KB8NNNC', 'MPN:LCSC': 'C14663' }
for (const c of [C_RST, ...C_RAM]) c.source(C0603_100N)
for (const c of C_MCU) c.source({ MPN: 'CL05B104KO5NNNC', 'MPN:LCSC': 'C1525' })
for (const c of [C_VCAP1, C_VCAP2]) c.source({ MPN: 'CL05A225MQ5NSNC', 'MPN:LCSC': 'C12530' })
for (const c of [C_X1, C_X2]) c.source({ MPN: 'CL10C120JB8NNNC', 'MPN:LCSC': 'C38523' })
C_IN.source({ MPN: 'CL21A106KAYNNNE', 'MPN:LCSC': 'C15850' })
C_OUT.source({ MPN: 'CL21A226MAQNNNE', 'MPN:LCSC': 'C45783' })
for (const r of [R_CC1, R_CC2]) r.source({ MPN: 'RC0603FR-075K1L', 'MPN:LCSC': 'C23186' })
R_BOOT.source({ MPN: 'RC0603FR-0710KL', 'MPN:LCSC': 'C25804' })
