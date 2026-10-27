// BME280 on I2C at 0x76: CSB to VDD selects I2C, SDO to GND sets the address. Decoupling and the bus pull-ups live here.
import { circuit, type Ports } from '@pcbjs/core'
import { C0603, R0603 } from '@pcbjs/lib'
import { LGA8 } from './footprints'

export const bme280 = circuit('bme280', ({ VDD, GND, SDA, SCL }: Ports<'VDD' | 'GND' | 'SDA' | 'SCL'>) => ({
  U: LGA8('BME280', { MPN: 'BME280', 'MPN:LCSC': 'C92489', Manufacturer: 'Bosch' }).connect(GND, VDD, SDA, SCL, GND, VDD, GND, VDD),
  C: C0603('100n').connect(VDD, GND),
  RSDA: R0603('4k7').connect(VDD, SDA),
  RSCL: R0603('4k7').connect(VDD, SCL),
}))
