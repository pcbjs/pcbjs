# Generator asserts as contracts

A generator asserts what its author cared about: a port standing exactly 1 mm out of the case, 3 mm of wall between ports, vias on a grid, no via in a screw keep-out, symmetric decoupling. pcbjs keeps those as rules where it has one, and as a contract script over `pcbjs inspect --json` otherwise. The script imports the generator's own constants, so the two flows share one source of numbers while both exist.

## Which asserts become rules

| Assert | pcbjs |
| --- | --- |
| no part, silk or pad within w of the edge but the ports | `rules.edge` with `except` |
| keep-out around a screw, under an antenna | `keepout()` |
| bottom copper is pads only | `keepout('B.Cu', OUTLINE)` |
| fine-pitch pad clearances, power track clearances | overrides and clearance by kind |
| mask web, hole spacing by kind | `maskWeb`, `minHoleToHole: { pad, via }` |
| mated pins agree across boards | `reference()` with `mate.nets` |

Everything positional that names particular items stays a contract.

## A contract in Python

```python
import json
import subprocess
import sys

sys.path.insert(0, "../board")
from placement import PORT_OUT, PORTS, WALL_MIN  # the generator's own numbers

out = subprocess.run(["npx", "pcbjs", "inspect", *[f"part:{r}" for r in PORTS], "--json", "--fresh"], capture_output=True, text=True)
data = json.loads(out.stdout)
right = data["frame"]["outline"]["x"][1]
parts = {r["footprint"]["ref"]: r["footprint"] for r in data["results"] if r.get("footprint")}


def box(ref, kind="Fab"):
    fp = parts[ref]
    layer = ("B." if fp["side"] == "B" else "F.") + kind
    pts = [p for g in fp["graphics"] if g["layer"] == layer for path in g["paths"] for p in path]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


bad = []
for ref in PORTS:
    x1 = box(ref)[2]
    if abs(x1 - right - PORT_OUT) > 0.01:
        bad.append(f"{ref} stands {x1 - right:.3f} mm out, want {PORT_OUT}")
ordered = sorted(PORTS, key=lambda r: box(r)[1])
for a, b in zip(ordered, ordered[1:]):
    wall = box(b, "CrtYd")[1] - box(a, "CrtYd")[3]
    if wall < WALL_MIN:
        bad.append(f"{a} to {b}: case wall {wall:.2f} mm, want {WALL_MIN}")

print(f"contracts  {len(bad)} violations")
print("\n".join(bad))
sys.exit(1 if bad else 0)
```

A JavaScript version of the same pattern is in the pcbjs-best-practices skill. Either way:

- One inspect call for every part and net the contracts need; each call is a compile.
- Footprint pads in the JSON carry no `ref`; add it when you flatten them.
- `inspect --layer F.SilkS --json` gives every silk stroke and glyph with bounds, for silk contracts; check drawings per segment, not by bounding box.
- Probe each contract with a scratch move of 0.1 mm that DRC passes: exactly the expected violations must appear.
- When the Python flow is retired, move the constants into a TypeScript module the board imports and port the script to JavaScript.
