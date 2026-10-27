# Model sources

Where each model file in this folder came from and when it was added. Check the licence of each source before you share or sell a design with the model: manufacturer models usually allow use in designs but not redistribution, and KiCad's packages3D models are CC-BY-SA 4.0 with an exception that lets designs and generated files use them freely.

- `Bosch_LGA-8_2.5x2.5mm_P0.65mm_ClockwisePinNumbering.step`: https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Package_LGA.3dshapes/Bosch_LGA-8_2.5x2.5mm_P0.65mm_ClockwisePinNumbering.step, added 2026-10-25
- `LGA-16_3x3mm_P0.5mm_LayoutBorder3x5y.step`: https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Package_LGA.3dshapes/LGA-16_3x3mm_P0.5mm_LayoutBorder3x5y.step, added 2026-10-25
- `microSD_HC_Hirose_DM3AT-SF-PEJM5.step`: https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Connector_Card.3dshapes/microSD_HC_Hirose_DM3AT-SF-PEJM5.step, added 2026-10-25
- `Buzzer_Murata_PKMCS0909E.step`: https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Buzzer_Beeper.3dshapes/Buzzer_Murata_PKMCS0909E.step, added 2026-10-25
- `SOT-23-5.step`: https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Package_TO_SOT_SMD.3dshapes/SOT-23-5.step, added 2026-10-25
- `SOIC-8_3.9x4.9mm_P1.27mm.step`: https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Package_SO.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.step, added 2026-10-25
- `JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical.step`: https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Connector_JST.3dshapes/JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical.step, added 2026-10-25
- `PinSocket_2x20_P2.54mm_Vertical.step`: https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Connector_PinSocket_2.54mm.3dshapes/PinSocket_2x20_P2.54mm_Vertical.step, added 2026-10-25
- `TYPE-C-31-M-17.step`: lcsc:C283540, https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/a8c86ef7d632469a8c796c24a9574b1e, added 2026-10-25
- `WS2812B-2020.step`: lcsc:C965555, https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/caa88715b11f4aa189b02e52bbb84e4f, added 2026-10-25
- `TS-1187A-B-A-B.step`: lcsc:C318884, https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/91b67c1735f643ffb2e7226c23dd3492, added 2026-10-25

## Notes

- The eight KiCad files are from kicad-packages3D, CC-BY-SA 4.0 with KiCad's exception for designs and generated files.
- The three easyeda.com files are LCSC's EasyEDA library models for LCSC parts C283540, C965555 and C318884, found through `https://easyeda.com/api/products/<LCSC>/components`, whose footprint carries the model id. They are LCSC's, under EasyEDA's terms of use; not redistributed: the repository ignores them and `scripts/check-examples.mjs` fetches them with `pcbjs model add lcsc:<C-number>` from the lines above.
- Tried first and not used: Molex for the 104031-0811 socket, unreachable from a script; JST, whose STEP downloads are behind an email form; Bosch and ST, which publish no STEP of their own and point to SnapEDA and Ultra Librarian, both behind a login.
