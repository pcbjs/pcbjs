# Reviewed pin and frame contracts

Use this when defining a pin map, custom cable or inspect-derived escape geometry. Read `docs import` for `withPins`, `docs layout` for local placement, and `docs testing` plus `docs queries` for board assertions. Keep existing owner positions and reviewed manual routes.

## Pins and endpoints

Review every physical pad against the manufacturer pin table. In the existing pinout source, distinguish connected, deliberately unused, datasheet-NC and required-but-unresolved pins. Include the source revision/page where it changes a decision. A missing row or unknown signal must fail rather than fall through to NC. Keep required unresolved signals visible; no blanket NC map or interface allowlist can establish that they are optional.

Compare the reviewed pad set with the actual footprint pad set in both directions. Check uniqueness only for signals that must be unique: repeated GND and NC labels are legal. Prefer named physical handles through `withPins`; do not reverse a nonunique map with `Object.fromEntries`.

Assert every selected connector endpoint and P/N polarity against an independently reviewed literal endpoint table, not one generated from the mapper being tested. In a board test, resolve each physical pad and compare its net with the expected net. Test invalid pad lookup and duplicate unique names too. A route reaching its generated endpoint proves connectivity, not that the endpoint is the intended manufacturer pin.

## Frames

Prefer shared placement constants and group-local escape points. When global waypoints intentionally come from `inspect`, assert the part/connector position, rotation and side in a board test before relying on those points. A translation or rotation must either transform the full escape coherently or fail the guard. Preserve endpoint identity, corridor layer and intentional via-count constraints when changing geometry.

## Sourcing

Distinguish package body dimensions, recommended land pattern, pin numbering/orientation and a visual model. Retain the manufacturer document/revision and material CAD disagreement beside the existing footprint definition or project notes. A populated MPN, plausible model or clean fit check does not establish sourcing suitability. Record only assumptions needed for future work; do not create a new ledger, board warning or fabrication disclaimer by default.

The package test `tests/intent-recipes.test.mjs` exercises these contracts with an independent tiny connector fixture. Adapt the assertions to the actual board API and reviewed hardware data; its illustrative pinout is not a vendor pinout.
