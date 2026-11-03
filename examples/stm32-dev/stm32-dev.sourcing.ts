// Part numbers for stm32-dev: MPN is the catch-all, MPN:LCSC what JLCPCB assembles, MPN:DigiKey for the OSH Park target.
import { U1, USB, LDO, HSE, LSE, R3, R4, R5, R6, R7, C7, C8, C9, C10, C11, C12, SW1, SW2, D1, D2, J2, J3, J4 } from './stm32-dev.sch'

const R5K1 = { MPN: 'RC0603FR-075K1L', 'MPN:LCSC': 'C23186', 'MPN:DigiKey': '311-5.10KHRCT-ND' }
const R10K = { MPN: 'RC0603FR-0710KL', 'MPN:LCSC': 'C25804', 'MPN:DigiKey': '311-10.0KHRCT-ND' }
const R1K = { MPN: 'RC0603FR-071KL', 'MPN:LCSC': 'C21190', 'MPN:DigiKey': '311-1.00KHRCT-ND' }
const C100N = { MPN: 'CL10B104KB8NNNC', 'MPN:LCSC': 'C14663', 'MPN:DigiKey': '1276-1000-1-ND' }
const C20P = { MPN: 'CL10C200JB8NNNC', 'MPN:LCSC': 'C1648', 'MPN:DigiKey': '1276-1201-1-ND' }
const C10P = { MPN: 'CL10C100JB8NNNC', 'MPN:LCSC': 'C1634', Manufacturer: 'Samsung', 'MPN:DigiKey': '1276-1012-1-ND' }
const TACT = { MPN: 'TS-1088-AR02016', Manufacturer: 'XKB', 'MPN:LCSC': 'C720477' }
const ROW19 = { MPN: 'PZ254V-11-19P', 'MPN:LCSC': 'C2718493' }

// the passives, one part number per value
for (const r of [USB.R1, USB.R2]) r.source(R5K1)
for (const r of [R4, R5]) r.source(R10K)
for (const r of [R6, R7]) r.source(R1K)
R3.source({ MPN: 'RC0603FR-071K5L', 'MPN:LCSC': 'C22843', 'MPN:DigiKey': '311-1.50KHRCT-ND' })
for (const c of [C7, C8, C9, C10, C11, C12]) c.source(C100N)
LDO.C1.source({ MPN: 'CL10A105KB8NNNC', 'MPN:LCSC': 'C15849', 'MPN:DigiKey': '1276-1102-1-ND' })
LDO.C2.source({ MPN: 'CL10A475KO8NNNC', 'MPN:LCSC': 'C19666', 'MPN:DigiKey': '1276-1044-1-ND' })
for (const c of [HSE.C1, HSE.C2]) c.source(C20P)
for (const c of [LSE.C1, LSE.C2]) c.source(C10P)

U1.source({ MPN: 'STM32F103C8T6', Manufacturer: 'STMicroelectronics', 'MPN:LCSC': 'C8734', 'MPN:DigiKey': '497-6063-ND' })
USB.J1.source({ MPN: 'TYPE-C-31-M-12', Manufacturer: 'HRO', 'MPN:LCSC': 'C165948' })
LDO.U1.source({ MPN: 'XC6206P332MR', Manufacturer: 'Torex', 'MPN:LCSC': 'C5446', 'MPN:DigiKey': '893-1069-1-ND' })
HSE.Y1.source({ MPN: 'X322508MSB4SI', Manufacturer: 'Yangxing', 'MPN:LCSC': 'C9002' })
LSE.Y1.source({ MPN: 'Q13FC13500004', Manufacturer: 'Epson', 'MPN:LCSC': 'C32346', 'MPN:DigiKey': 'SER4058CT-ND' })
for (const sw of [SW1, SW2]) sw.source(TACT)
D1.source({ MPN: 'KT-0603R', 'MPN:LCSC': 'C2286', 'MPN:DigiKey': '160-1447-1-ND' })
D2.source({ MPN: 'KT-0603G', 'MPN:LCSC': 'C72043', 'MPN:DigiKey': '160-1446-1-ND' })
J2.source({ MPN: 'PZ254V-11-05P', 'MPN:LCSC': 'C492403' })
for (const j of [J3, J4]) j.source(ROW19)
