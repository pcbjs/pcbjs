---
title: Verify part models in 3D
description: Identify generated bodies, add a model file and check its placement.
---

# Verify part models in 3D

A convincing render and a correctly aligned package are different things. This lesson identifies where a part's model comes from, then checks a file model against its pads and board face.

## Inspect the existing bodies

Open your board's 3D view and select a resistor or connector. Some standard parts use generated bodies; others fetch model files. A missing model is shown as an outline rather than a verified solid body.

Blinky combines ordinary component placements with a back-side capacitor. Use the complete source and matching preview to explore the part positions and switch to 3D, then compare top and bottom views in the full viewer.

<GuideDemo example="blinky-placement" />

Run these commands in your own project:

```sh
npx pcbjs model check
npx pcbjs shot --view 3d
```

The model report distinguishes file models, generated models, missing models and parts with no body. Use that report alongside the picture, especially for connectors and tall components.

## Add and align a local file

Download or obtain the actual package model, then run the following with its local path and the reference of the placed part:

```sh
npx pcbjs model add ./downloads/connector.step --ref J1 --write
npx pcbjs model align J1
npx pcbjs model check
npx pcbjs shot --view 3d --select J1
```

`model add` copies the file into the project's `models/` directory and writes the model option when requested. `align` reports the proposed transform and its confidence. Inspect the result rather than assuming an automatic fit resolved pin 1 correctly, especially for a symmetric package.

For a local file, the part's model option names its `file` path. The preview above uses the actual supplied models; it does not pretend to render a connector file you have not added. Inspect your local preview after running the commands.

The file path is relative to the source file holding the model literal. Moving that literal into a reusable library can therefore change the required relative path. An `offset` is measured in millimetres; `rotate` uses degrees about x, y and z.

## Check the mechanical meaning

Look from both sides. Contacts should meet their pads, a surface-mount body should sit at the correct board face, and connector openings should point in the intended direction. Resolve model placement warnings and compare package dimensions with the actual part information. Retain each model's source and licence information before sharing it.

You can now explain whether a body is generated, fetched or supplied locally, and verify its placement. The [Models reference](/docs/models) covers acquisition and alignment; [3D model files](/docs/3d#model-files) defines the frame and transforms. Continue with [manufacturing review](./manufacturing).
