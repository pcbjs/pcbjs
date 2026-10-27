// Coin: two test pads on the battery net of a 20 mm round board. The small-board example: nets, parts and layout in one file.
// Frame: millimetres, origin at the top-left corner of the outline's bounding box, x right, y down; the centre is at 10 10.
import PCB, { circuit, nets, route } from '@pcbjs/core'
import { Brand } from '@pcbjs/lib'
import { TestPad } from './lib/TestPad'

// Nets
const { VBAT } = nets()

// Parts: the two pads, gathered as the board's one circuit with the object form. Test pads stay out of the BOM, so there is nothing to source.
const Coin = circuit('Coin', {
  TP1: TestPad('VBAT').connect(VBAT),
  TP2: TestPad('VBAT').connect(VBAT),
})

export default (
  // the project config sets JLCPCB's rules for every board; this board asks for a wider clearance and track on top
  <PCB name="Coin" revision="0.1.0" copper={2} rules={{ clearance: 0.2, minTrackWidth: 0.2 }}>
    {/* outline: a 20 mm circle */}
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />

    {/* the pads, 5 mm either side of the centre */}
    <Coin.TP1 at="5 10" />
    <Coin.TP2 at="15 10" />

    {/* VBAT: one straight track between them */}
    {route(Coin.TP1[1]).Z(Coin.TP2[1]).width(0.5)}

    {/* silk */}
    <text layer="F.SilkS" at="10 14" size={1}>Coin · pcbjs</text>
    <Brand at="10 5.3" height={4} />
  </PCB>
)
