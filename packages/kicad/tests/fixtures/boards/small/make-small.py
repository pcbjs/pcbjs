# Builds packages/kicad/tests/fixtures/boards/small/small.kicad_pcb with KiCad 10's own pcbnew: library footprints of several pad
# shapes, front and back, rotated, tracks with vias and an arc, a GND zone, a keepout, an outline with an arc and a round cutout, and text.
# Run with KiCad's Python: <KiCad.app>/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3.9 -I make-small.py small.kicad_pcb
# then kicad-cli pcb export gerbers -l F.Cu,B.Cu,F.Mask,B.Mask,Edge.Cuts,F.Paste,B.Paste --no-protel-ext -o kicad-fab/ small.kicad_pcb
# and kicad-cli pcb export drill --excellon-separate-th -o kicad-fab/ small.kicad_pcb
import pcbnew, sys
LIB = '/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints/'
mm = pcbnew.FromMM
P = lambda x, y: pcbnew.VECTOR2I(mm(x), mm(y))
b = pcbnew.BOARD()
nets = {}
for n in ['GND', 'VCC', 'SIG']:
    ni = pcbnew.NETINFO_ITEM(b, n); b.Add(ni); nets[n] = ni

def place(lib, name, ref, value, x, y, rot, back=False, padnets={}):
    fp = pcbnew.FootprintLoad(LIB + lib + '.pretty', name)
    fp.SetFPID(pcbnew.LIB_ID(lib, name))
    fp.SetReference(ref); fp.SetValue(value)
    b.Add(fp)
    fp.SetPosition(P(x, y))
    if back: fp.Flip(P(x, y), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
    fp.SetOrientationDegrees(rot)
    for p in fp.Pads():
        if p.GetNumber() in padnets: p.SetNet(nets[padnets[p.GetNumber()]])
    return fp

U1 = place('Package_SO', 'SOIC-8_3.9x4.9mm_P1.27mm', 'U1', 'LM358', 14, 12, 90, padnets={'1': 'SIG', '4': 'GND', '8': 'VCC'})
D1 = place('Diode_SMD', 'D_SMA-SMB_Universal_Handsoldering', 'D1', 'SS14', 30, 9, 30, back=True, padnets={'1': 'VCC', '2': 'GND'})
J1 = place('Connector_Molex', 'Molex_Nano-Fit_105309-xx02_1x02_P2.50mm_Vertical', 'J1', 'Nano-Fit', 7, 22, 0, padnets={'1': 'VCC', '2': 'GND'})
L1 = place('Inductor_SMD', 'L_Bourns_SDR0604', 'L1', '10u', 29, 21, -90, back=True, padnets={'1': 'SIG', '2': 'VCC'})
R1 = place('Resistor_SMD', 'R_0603_1608Metric', 'R1', '10k', 20, 24, 45, padnets={'1': 'SIG', '2': 'GND'})
Q1 = place('Package_TO_SOT_SMD', 'SOT-23', 'Q1', 'MMBT3904', 21, 6, 180, back=True, padnets={'1': 'SIG', '2': 'GND'})

def seg(a, c, layer, w, net):
    t = pcbnew.PCB_TRACK(b); t.SetStart(P(*a)); t.SetEnd(P(*c)); t.SetLayer(layer); t.SetWidth(mm(w)); t.SetNet(nets[net]); b.Add(t)
def via(at, net, size=0.6, drill=0.3):
    v = pcbnew.PCB_VIA(b); v.SetPosition(P(*at)); v.SetWidth(mm(size)); v.SetDrill(mm(drill)); v.SetNet(nets[net]); b.Add(v)

pad = lambda fp, n: [p for p in fp.Pads() if p.GetNumber() == n][0]
xy = lambda p: (pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y))
# SIG: U1.1 to R1.1, through a via to the back and up again
a = xy(pad(U1, '1')); r = xy(pad(R1, '1'))
seg(a, (a[0], 17), pcbnew.F_Cu, 0.25, 'SIG'); seg((a[0], 17), (16, 19), pcbnew.F_Cu, 0.25, 'SIG'); via((16, 19), 'SIG')
seg((16, 19), (16, 23), pcbnew.B_Cu, 0.25, 'SIG'); via((16, 23), 'SIG'); seg((16, 23), r, pcbnew.F_Cu, 0.25, 'SIG')
# VCC: U1.8 to J1.1 with a 0.4 track and an arc
v8 = xy(pad(U1, '8')); j1 = xy(pad(J1, '1'))
seg(v8, (v8[0], 4), pcbnew.F_Cu, 0.4, 'VCC'); seg((v8[0], 4), (8, 4), pcbnew.F_Cu, 0.4, 'VCC')
arc = pcbnew.PCB_ARC(b); arc.SetStart(P(8, 4)); arc.SetMid(P(5.5, 6.5)); arc.SetEnd(P(7, 9)); arc.SetLayer(pcbnew.F_Cu); arc.SetWidth(mm(0.4)); arc.SetNet(nets['VCC']); b.Add(arc)
seg((7, 9), j1, pcbnew.F_Cu, 0.4, 'VCC')

# outline: a 40 x 30 rectangle with one rounded corner, and a round cutout
def gr(shape, layer, pts, w=0.1):
    s = pcbnew.PCB_SHAPE(b); s.SetShape(shape); s.SetLayer(layer); s.SetWidth(mm(w))
    return s
for (p0, p1) in [((0, 0), (36, 0)), ((40, 4), (40, 30)), ((40, 30), (0, 30)), ((0, 30), (0, 0))]:
    s = pcbnew.PCB_SHAPE(b); s.SetShape(pcbnew.SHAPE_T_SEGMENT); s.SetLayer(pcbnew.Edge_Cuts); s.SetWidth(mm(0.05)); s.SetStart(P(*p0)); s.SetEnd(P(*p1)); b.Add(s)
s = pcbnew.PCB_SHAPE(b); s.SetShape(pcbnew.SHAPE_T_ARC); s.SetLayer(pcbnew.Edge_Cuts); s.SetWidth(mm(0.05)); s.SetArcGeometry(P(36, 0), P(36 + 4 * 0.7071068, 4 - 4 * 0.7071068), P(40, 4)); b.Add(s)
s = pcbnew.PCB_SHAPE(b); s.SetShape(pcbnew.SHAPE_T_CIRCLE); s.SetLayer(pcbnew.Edge_Cuts); s.SetWidth(mm(0.05)); s.SetCenter(P(35, 15)); s.SetEnd(P(36.5, 15)); b.Add(s)
# silk art and text
s = pcbnew.PCB_SHAPE(b); s.SetShape(pcbnew.SHAPE_T_RECT); s.SetLayer(pcbnew.F_SilkS); s.SetWidth(mm(0.15)); s.SetStart(P(2, 26)); s.SetEnd(P(6, 28.5)); b.Add(s)
for layer, txt, at, mirror in [(pcbnew.F_SilkS, 'IMPORT', (10, 28), False), (pcbnew.B_SilkS, 'BACK', (30, 28), True)]:
    t = pcbnew.PCB_TEXT(b); t.SetText(txt); t.SetLayer(layer); t.SetPosition(P(*at)); t.SetTextSize(pcbnew.VECTOR2I(mm(1.2), mm(1.2))); t.SetTextThickness(mm(0.2)); t.SetMirrored(mirror); b.Add(t)

# a GND pour on the back and a keepout for pours on the front
def zone(net, layer, pts, keepout=False):
    z = pcbnew.ZONE(b); z.SetLayer(layer)
    ol = z.Outline(); ol.NewOutline()
    for p in pts: ol.Append(mm(p[0]), mm(p[1]))
    if keepout:
        z.SetIsRuleArea(True); z.SetDoNotAllowTracks(False); z.SetDoNotAllowVias(False); z.SetDoNotAllowZoneFills(True); z.SetDoNotAllowPads(False); z.SetDoNotAllowFootprints(False)
    else:
        z.SetNet(nets[net]); z.SetLocalClearance(mm(0.3)); z.SetMinThickness(mm(0.25))
    b.Add(z)
    return z
zone('GND', pcbnew.B_Cu, [(1, 1), (39, 1), (39, 29), (1, 29)])
zone(None, pcbnew.F_Cu, [(30, 24), (34, 24), (34, 28), (30, 28)], keepout=True)
filler = pcbnew.ZONE_FILLER(b); filler.Fill(b.Zones())
b.Save(sys.argv[1])
