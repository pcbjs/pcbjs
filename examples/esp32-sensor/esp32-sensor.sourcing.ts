// ESP32 sensor node, the sourcing: LCSC numbers for JLCPCB assembly, MPN as the catch-all. pcb.tsx imports this module.
// The LDO and BME280 carry their numbers in lib/; the passives are set here by value.
import { source } from '@pcbjs/core'
import { R0603, C0603, LED0603 } from '@pcbjs/lib'
import { J1, U1, U2, SW1, SW2, J2 } from './esp32-sensor.sch'

source(R0603, '5k1', { MPN: '0603WAF5101T5E', 'MPN:LCSC': 'C23186', Manufacturer: 'UNI-ROYAL' })
source(R0603, '10k', { MPN: '0603WAF1002T5E', 'MPN:LCSC': 'C25804', Manufacturer: 'UNI-ROYAL' })
source(R0603, '4k7', { MPN: '0603WAF4701T5E', 'MPN:LCSC': 'C23162', Manufacturer: 'UNI-ROYAL' })
source(R0603, '1k', { MPN: '0603WAF1001T5E', 'MPN:LCSC': 'C21190', Manufacturer: 'UNI-ROYAL' })
source(C0603, '100n', { MPN: 'CC0603KRX7R9BB104', 'MPN:LCSC': 'C14663', Manufacturer: 'YAGEO' })
source(C0603, '1u', { MPN: 'CL10A105KB8NNNC', 'MPN:LCSC': 'C15849', Manufacturer: 'Samsung' })
source(C0603, '10u', { MPN: 'CL10A106KP8NNNC', 'MPN:LCSC': 'C19702', Manufacturer: 'Samsung' })
source(LED0603, 'green', { MPN: 'KT-0603G', 'MPN:LCSC': 'C72043', Manufacturer: 'Hubei KENTO' })

source(U1, { MPN: 'ESP32-C3-MINI-1-N4', 'MPN:LCSC': 'C2838502', Manufacturer: 'Espressif' })
source(J1, { MPN: 'TYPE-C-31-M-12', 'MPN:LCSC': 'C165948', Manufacturer: 'Korean Hroparts' })
source(U2, { MPN: 'USBLC6-2SC6', 'MPN:LCSC': 'C7519', Manufacturer: 'STMicroelectronics' })
source([SW1, SW2], { MPN: 'TS-1187A-B-A-B', 'MPN:LCSC': 'C318884', Manufacturer: 'XKB' })
source(J2, { MPN: 'PZ254V-11-06P', 'MPN:LCSC': 'C2937625', Manufacturer: 'XFCN' })
