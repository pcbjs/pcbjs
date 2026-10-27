// Part numbers for stm32-dev: MPN is the catch-all, MPN:LCSC what JLCPCB assembles, MPN:DigiKey for the OSH Park target.
import { source } from '@pcbjs/core'
import { C0603, R0603 } from '@pcbjs/lib'
import { U1, USB, LDO, HSE, LSE, SW_RST, SW_BOOT, D_PWR, D_USR, J_SWD, J_TOP, J_BOT } from './stm32-dev.sch'

source(R0603, '5k1', { MPN: 'RC0603FR-075K1L', 'MPN:LCSC': 'C23186', 'MPN:DigiKey': '311-5.10KHRCT-ND' })
source(R0603, '10k', { MPN: 'RC0603FR-0710KL', 'MPN:LCSC': 'C25804', 'MPN:DigiKey': '311-10.0KHRCT-ND' })
source(R0603, '1k', { MPN: 'RC0603FR-071KL', 'MPN:LCSC': 'C21190', 'MPN:DigiKey': '311-1.00KHRCT-ND' })
source(R0603, '1k5', { MPN: 'RC0603FR-071K5L', 'MPN:LCSC': 'C22843', 'MPN:DigiKey': '311-1.50KHRCT-ND' })
source(C0603, '100n', { MPN: 'CL10B104KB8NNNC', 'MPN:LCSC': 'C14663', 'MPN:DigiKey': '1276-1000-1-ND' })
source(C0603, '1u', { MPN: 'CL10A105KB8NNNC', 'MPN:LCSC': 'C15849', 'MPN:DigiKey': '1276-1102-1-ND' })
source(C0603, '4.7u', { MPN: 'CL10A475KO8NNNC', 'MPN:LCSC': 'C19666', 'MPN:DigiKey': '1276-1044-1-ND' })
source(C0603, '20p', { MPN: 'CL10C200JB8NNNC', 'MPN:LCSC': 'C1648', 'MPN:DigiKey': '1276-1201-1-ND' })
source(C0603, '10p', { MPN: 'CL10C100JB8NNNC', 'MPN:LCSC': 'C1634', Manufacturer: 'Samsung', 'MPN:DigiKey': '1276-1012-1-ND' })

source(U1, { MPN: 'STM32F103C8T6', Manufacturer: 'STMicroelectronics', 'MPN:LCSC': 'C8734', 'MPN:DigiKey': '497-6063-ND' })
source(USB.J, { MPN: 'TYPE-C-31-M-12', Manufacturer: 'HRO', 'MPN:LCSC': 'C165948' })
source(LDO.U, { MPN: 'XC6206P332MR', Manufacturer: 'Torex', 'MPN:LCSC': 'C5446', 'MPN:DigiKey': '893-1069-1-ND' })
source(HSE.Y, { MPN: 'X322508MSB4SI', Manufacturer: 'Yangxing', 'MPN:LCSC': 'C9002' })
source(LSE.Y, { MPN: 'Q13FC13500004', Manufacturer: 'Epson', 'MPN:LCSC': 'C32346', 'MPN:DigiKey': 'SER4058CT-ND' })
source([SW_RST, SW_BOOT], { MPN: 'TS-1088-AR02016', Manufacturer: 'XKB', 'MPN:LCSC': 'C720477' })
source(D_PWR, { MPN: 'KT-0603R', 'MPN:LCSC': 'C2286', 'MPN:DigiKey': '160-1447-1-ND' })
source(D_USR, { MPN: 'KT-0603G', 'MPN:LCSC': 'C72043', 'MPN:DigiKey': '160-1446-1-ND' })
source(J_SWD, { MPN: 'PZ254V-11-05P', 'MPN:LCSC': 'C492403' })
source([J_TOP, J_BOT], { MPN: 'PZ254V-11-19P', 'MPN:LCSC': 'C2718493' })
