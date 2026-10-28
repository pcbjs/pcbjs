# Make targets beside the Python flow

Add pcbjs targets at the end of the Makefile and leave the existing ones as they are. Each prints one summary line and fails with its findings.

```make
PCBJS := npx pcbjs
PCBJS_DIR := pcbjs
KICAD_PCB := board/Name.kicad_pcb

.PHONY: pcbjs pcbjs-check pcbjs-netcheck pcbjs-contracts pcbjs-build pcbjs-dev

pcbjs-check: pcbjs-models
	cd $(PCBJS_DIR) && $(PCBJS) check --fab
	cd $(PCBJS_DIR) && $(PCBJS) model check

pcbjs-netcheck:
	cd $(PCBJS_DIR) && node tools/netcheck.mjs ../$(KICAD_PCB) pcb.tsx

pcbjs-contracts:
	cd $(PCBJS_DIR) && node tools/contracts.mjs

pcbjs-build:
	cd $(PCBJS_DIR) && SOURCE_DATE_EPOCH=$$(git log -1 --format=%ct -- . ../lib/footprints) $(PCBJS) build -q

pcbjs-dev:
	cd $(PCBJS_DIR) && $(PCBJS) dev -p 5300

pcbjs: pcbjs-check pcbjs-netcheck pcbjs-contracts pcbjs-build
```

- `pcbjs-check` first, since a failing compile makes the other targets meaningless.
- `pcbjs-models` is a target that fetches models whose licence forbids committing them, see the pcbjs-best-practices skill; drop it when every model is in git.
- Pass the same environment the generators get, `VARIANT=… make pcbjs`, so both flows build the same variant.
- The fab stamp comes from the last commit that touched the design, so a rebuild of a commit is byte identical.
- A dev port of its own keeps the pcbjs viewer apart from any viewer the Python flow serves.
- CI can run the same targets once pcbjs installs from npm.
