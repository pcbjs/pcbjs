// Multi, the schematic: VBAT in at TP1, through R1, out at TP2.
// R1 has a part number per sourcing tag: JLCPCB orders the LCSC one, OSH Park the US one, House the catch-all MPN.
import { nets } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
import { TestPad } from './lib/TestPad'

export const { VBAT, OUT } = nets()
export const TP1 = TestPad('VBAT').connect({ 1: VBAT })
export const R1 = R0603('1k').source({ MPN: 'RC0603FR-071KL', 'MPN:US': 'ERJ-3EKF1001V', 'MPN:LCSC': 'C21190' }).connect({ 1: VBAT, 2: OUT })
export const TP2 = TestPad('OUT').connect({ 1: OUT })
