// ESP32 sensor node, the sourcing: LCSC numbers for JLCPCB assembly, MPN as the catch-all. pcb.tsx imports this module.
// The LDO and BME280 carry their numbers in lib/; the passives are set here, one spec per value.
import { J1, U1, U2, SW1, SW2, J2, R1, R2, R3, R4, C1, C2, C3, D1, LDO, SENS } from './esp32-sensor.sch'

const R5K1 = { MPN: '0603WAF5101T5E', 'MPN:LCSC': 'C23186', Manufacturer: 'UNI-ROYAL' }
const R10K = { MPN: '0603WAF1002T5E', 'MPN:LCSC': 'C25804', Manufacturer: 'UNI-ROYAL' }
const R4K7 = { MPN: '0603WAF4701T5E', 'MPN:LCSC': 'C23162', Manufacturer: 'UNI-ROYAL' }
const R1K = { MPN: '0603WAF1001T5E', 'MPN:LCSC': 'C21190', Manufacturer: 'UNI-ROYAL' }
const C100N = { MPN: 'CC0603KRX7R9BB104', 'MPN:LCSC': 'C14663', Manufacturer: 'YAGEO' }
const C1U = { MPN: 'CL10A105KB8NNNC', 'MPN:LCSC': 'C15849', Manufacturer: 'Samsung' }
const C10U = { MPN: 'CL10A106KP8NNNC', 'MPN:LCSC': 'C19702', Manufacturer: 'Samsung' }

for (const r of [R1, R2]) r.source(R5K1)
R3.source(R10K)
R4.source(R1K)
for (const r of [SENS.R1, SENS.R2]) r.source(R4K7)
for (const c of [C2, SENS.C]) c.source(C100N)
for (const c of [C3, LDO.C1, LDO.C2]) c.source(C1U)
C1.source(C10U)
D1.source({ MPN: 'KT-0603G', 'MPN:LCSC': 'C72043', Manufacturer: 'Hubei KENTO' })

U1.source({ MPN: 'ESP32-C3-MINI-1-N4', 'MPN:LCSC': 'C2838502', Manufacturer: 'Espressif' })
J1.source({ MPN: 'TYPE-C-31-M-12', 'MPN:LCSC': 'C165948', Manufacturer: 'Korean Hroparts' })
U2.source({ MPN: 'USBLC6-2SC6', 'MPN:LCSC': 'C7519', Manufacturer: 'STMicroelectronics' })
for (const sw of [SW1, SW2]) sw.source({ MPN: 'TS-1187A-B-A-B', 'MPN:LCSC': 'C318884', Manufacturer: 'XKB' })
J2.source({ MPN: 'PZ254V-11-06P', 'MPN:LCSC': 'C2937625', Manufacturer: 'XFCN' })
