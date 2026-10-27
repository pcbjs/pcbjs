// Sensor HAT schematic: the Pi's 40-pin header, I2C sensors, SPI micro SD, LiPo charger, HAT ID EEPROM, buzzer, buttons and an addressable LED.
// Power: the Pi gives 3V3 to the logic and 5V to the LED and buzzer. USB-C only charges the LiPo on J4; the cell powers nothing on this board.
import { nets, NC } from '@pcbjs/core'
import { PinSocket, PinHeader, JST_PH, USBC, SOT23, SOIC, TactSwitch, WS2812B, R0603, C0603, LED0603, TestPad } from '@pcbjs/lib'
import { BME280, LIS3DH, DM3AT, PKMCS0909E } from './lib/footprints'

export const { GND, V3V3, V5, SDA, SCL, ID_SD, ID_SC, MOSI, MISO, SCLK, CE0, SD_CD, ACC_INT, LED_DIN, BUZ, BUZ_B, BUZ_C, BTN1, BTN2, WP } = nets({ V3V3: { class: 'power' }, V5: { class: 'power' }, GND: { class: 'power' } })
export const { VBUS, VBAT, CC1, CC2, PROG, STAT, CHG_LED } = nets({ VBUS: { class: 'power' }, VBAT: { class: 'power' } })

// Raspberry Pi GPIO, a 2 x 20 socket on the back of the HAT. Pin 1 3V3, odd pins on the inner row.
export const J1 = PinSocket(20, { rows: 2, value: 'GPIO 2x20', source: { MPN: 'SSQ-120-03-T-D' }, model: { file: './models/PinSocket_2x20_P2.54mm_Vertical.step', offset: [2.54, 0, 0] } }).connect({
  1: V3V3, 2: V5, 3: SDA, 4: V5, 5: SCL, 6: GND, 7: NC, 8: NC, 9: GND, 10: NC,
  11: ACC_INT, 12: LED_DIN, 13: NC, 14: GND, 15: NC, 16: NC, 17: V3V3, 18: NC, 19: MOSI, 20: GND,
  21: MISO, 22: SD_CD, 23: SCLK, 24: CE0, 25: GND, 26: NC, 27: ID_SD, 28: ID_SC, 29: BTN1, 30: GND,
  31: BTN2, 32: NC, 33: BUZ, 34: GND, 35: NC, 36: NC, 37: NC, 38: NC, 39: GND, 40: NC,
})

// BME280 at I2C 0x76: SDO low, CSB high for I2C
export const U1 = BME280({ value: 'BME280', source: { MPN: 'BME280', 'MPN:LCSC': 'C92489' }, model: { file: './models/Bosch_LGA-8_2.5x2.5mm_P0.65mm_ClockwisePinNumbering.step' } }).connect({ GND, CSB: V3V3, SDI: SDA, SCK: SCL, SDO: GND, VDDIO: V3V3, VDD: V3V3 })
export const C1 = C0603('100n').source({ MPN: 'CC0603KRX7R9BB104', 'MPN:LCSC': 'C14663' }).connect(V3V3, GND)

// LIS3DH at I2C 0x18: SA0 low, CS high for I2C, INT1 to GPIO17
export const U2 = LIS3DH({ value: 'LIS3DHTR', source: { MPN: 'LIS3DHTR', 'MPN:LCSC': 'C15134' }, model: { file: './models/LGA-16_3x3mm_P0.5mm_LayoutBorder3x5y.step' } }).connect({
  VDDIO: V3V3, SCL, GND, SDA, SA0: GND, CS: V3V3, INT2: NC, RES: GND, INT1: ACC_INT, ADC3: NC, VDD: V3V3, ADC2: NC, ADC1: NC,
})
export const C2 = C0603('100n').source({ MPN: 'CC0603KRX7R9BB104', 'MPN:LCSC': 'C14663' }).connect(V3V3, GND)

// OLED: the common 0.96 inch SSD1306 I2C module, GND VCC SCL SDA
export const J2 = PinHeader(4, { value: 'OLED I2C', source: { MPN: 'PEC04SAAN' } }).connect(GND, V3V3, SCL, SDA)

// micro SD in SPI mode on SPI0 CE0, card detect to GPIO25
export const J3 = DM3AT({ value: 'DM3AT-SF-PEJM5', source: { MPN: 'DM3AT-SF-PEJM5', 'MPN:LCSC': 'C114218' }, model: { file: './models/microSD_HC_Hirose_DM3AT-SF-PEJM5.step' } }).connect({
  DAT2: NC, DAT3: CE0, CMD: MOSI, VDD: V3V3, CLK: SCLK, VSS: GND, DAT0: MISO, DAT1: NC, CD: SD_CD, CDCOM: GND, SHIELD: GND,
})
export const C3 = C0603('10u').source({ MPN: 'CL10A106KP8NNNC', 'MPN:LCSC': 'C19702' }).connect(V3V3, GND)

// LiPo charger: USB-C sink with 5.1k on CC, MCP73831 at 500 mA (2k PROG), charge LED on STAT
export const J4 = USBC('power6', { value: 'TYPE-C-31-M-17', source: { MPN: 'TYPE-C-31-M-17', 'MPN:LCSC': 'C283540' }, model: { file: './models/TYPE-C-31-M-17.step', offset: [0, -0.8, 0], rotate: [0, 0, 180] } }).connect({ GND, VBUS, CC1, CC2, SHIELD: GND })
export const R1 = R0603('5.1k').source({ MPN: 'RC0603FR-075K1L', 'MPN:LCSC': 'C23186' }).connect(CC1, GND)
export const R2 = R0603('5.1k').source({ MPN: 'RC0603FR-075K1L', 'MPN:LCSC': 'C23186' }).connect(CC2, GND)
export const U3 = SOT23(5, { pinNames: ['STAT', 'VSS', 'VBAT', 'VDD', 'PROG'] })({ value: 'MCP73831T-2ACI/OT', source: { MPN: 'MCP73831T-2ACI/OT', 'MPN:LCSC': 'C424093' }, model: { file: './models/SOT-23-5.step', offset: [0.03, 0, 0] } }).connect({ STAT, VSS: GND, VBAT, VDD: VBUS, PROG })
export const C4 = C0603('4.7u').source({ MPN: 'CL10A475KO8NNNC', 'MPN:LCSC': 'C19666' }).connect(VBUS, GND)
export const C5 = C0603('4.7u').source({ MPN: 'CL10A475KO8NNNC', 'MPN:LCSC': 'C19666' }).connect(VBAT, GND)
export const R3 = R0603('2k').source({ MPN: 'RC0603FR-072KL', 'MPN:LCSC': 'C22975' }).connect(PROG, GND)
export const R4 = R0603('1k').source({ MPN: 'RC0603FR-071KL', 'MPN:LCSC': 'C21190' }).connect(VBUS, CHG_LED)
export const D1 = LED0603('red').source({ MPN: 'LTST-C190KRKT', 'MPN:LCSC': 'C2286' }).connect({ A: CHG_LED, K: STAT })
export const J5 = JST_PH(2, 'top', { value: 'B2B-PH-K-S', source: { MPN: 'B2B-PH-K-S(LF)(SN)', 'MPN:LCSC': 'C131337' }, model: { file: './models/JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical.step', offset: [-1, -0.16, 0] } }).connect(VBAT, GND)

// HAT ID EEPROM on ID_SD and ID_SC, address 0x50. WP is pulled high; short TP1 to GND to write it.
export const U4 = SOIC(8, 'N', { pinNames: ['A0', 'A1', 'A2', 'VSS', 'SDA', 'SCL', 'WP', 'VCC'] })({ value: 'CAT24C32WI-GT3', source: { MPN: 'CAT24C32WI-GT3', 'MPN:LCSC': 'C79079' }, model: { file: './models/SOIC-8_3.9x4.9mm_P1.27mm.step' } }).connect({
  A0: GND, A1: GND, A2: GND, VSS: GND, SDA: ID_SD, SCL: ID_SC, WP, VCC: V3V3,
})
export const C6 = C0603('100n').source({ MPN: 'CC0603KRX7R9BB104', 'MPN:LCSC': 'C14663' }).connect(V3V3, GND)
export const R5 = R0603('10k').source({ MPN: 'RC0603FR-0710KL', 'MPN:LCSC': 'C25804' }).connect(V3V3, WP)
export const TP1 = TestPad(1.2)('WP').connect(WP)

// Piezo sounder on 5V, switched by an NPN from GPIO13
export const BZ1 = PKMCS0909E({ value: 'PKMCS0909E4000-R1', source: { MPN: 'PKMCS0909E4000-R1', 'MPN:LCSC': 'C94599' }, model: { file: './models/Buzzer_Murata_PKMCS0909E.step', offset: [0, 0, -0.03] } }).connect({ 1: V5, 2: BUZ_C })
export const Q1 = SOT23(3)({ value: 'MMBT3904', source: { MPN: 'MMBT3904', 'MPN:LCSC': 'C20526' } }).connect({ 1: BUZ_B, 2: GND, 3: BUZ_C })
export const R6 = R0603('1k').source({ MPN: 'RC0603FR-071KL', 'MPN:LCSC': 'C21190' }).connect(BUZ, BUZ_B)

// Two buttons to GND, the Pi's internal pull-ups on GPIO5 and GPIO6
export const SW1 = TactSwitch('5.1x5.1')({ value: 'TS-1187A', source: { MPN: 'TS-1187A-B-A-B', 'MPN:LCSC': 'C318884' }, model: { file: './models/TS-1187A-B-A-B.step', offset: [0, 0, 0.05] } }).connect({ A: BTN1, B: GND })
export const SW2 = TactSwitch('5.1x5.1')({ value: 'TS-1187A', model: { file: './models/TS-1187A-B-A-B.step', offset: [0, 0, 0.05] }, source: { MPN: 'TS-1187A-B-A-B', 'MPN:LCSC': 'C318884' } }).connect({ A: BTN2, B: GND })

// WS2812B-2020 on 5V, data from GPIO18
export const D2 = WS2812B('2020')({ value: 'WS2812B-2020', source: { MPN: 'WS2812B-2020', 'MPN:LCSC': 'C965555' }, model: { file: './models/WS2812B-2020.step' } }).connect({ DIN: LED_DIN, DOUT: NC, VDD: V5, GND })
export const C7 = C0603('100n').source({ MPN: 'CC0603KRX7R9BB104', 'MPN:LCSC': 'C14663' }).connect(V5, GND)
