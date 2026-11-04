# usb3-hub

## Learning goal

A four port USB 3.2 hub on the 3313 four layer preset: SuperSpeed pairs through AC capacitors and ESD arrays, match groups per port, 115 autorouted legs

Each downstream port is a group with local part coordinates around the connector block. Only the parent placement carries the port's horizontal spacing and board offset, giving it a useful local rotation origin.

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/usb3-hub
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None.
