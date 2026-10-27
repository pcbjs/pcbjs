// Part numbers for the passives of sdram: MPN is the catch-all, MPN:LCSC what JLCPCB assembles.
import { source } from '@pcbjs/core'
import { C0402, C0603, C0805, R0603 } from '@pcbjs/lib'

source(C0603, '100n', { MPN: 'CL10B104KB8NNNC', 'MPN:LCSC': 'C14663' })
source(C0402, '100n', { MPN: 'CL05B104KO5NNNC', 'MPN:LCSC': 'C1525' })
source(C0402, '2.2u', { MPN: 'CL05A225MQ5NSNC', 'MPN:LCSC': 'C12530' })
source(C0603, '12p', { MPN: 'CL10C120JB8NNNC', 'MPN:LCSC': 'C38523' })
source(C0805, '10u', { MPN: 'CL21A106KAYNNNE', 'MPN:LCSC': 'C15850' })
source(C0805, '22u', { MPN: 'CL21A226MAQNNNE', 'MPN:LCSC': 'C45783' })
source(R0603, '5k1', { MPN: 'RC0603FR-075K1L', 'MPN:LCSC': 'C23186' })
source(R0603, '10k', { MPN: 'RC0603FR-0710KL', 'MPN:LCSC': 'C25804' })
