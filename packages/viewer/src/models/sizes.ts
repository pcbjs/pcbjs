// Imperial chip sizes: length, width and end-cap length in mm.
export const CHIP_SIZES: Record<string, { l: number; w: number; cap: number }> = {
  '0402': { l: 1.0, w: 0.5, cap: 0.25 },
  '0603': { l: 1.6, w: 0.8, cap: 0.3 },
  '0805': { l: 2.0, w: 1.25, cap: 0.4 },
  '1206': { l: 3.2, w: 1.6, cap: 0.5 },
}
export const chipSize = (size: string) => CHIP_SIZES[size] ?? CHIP_SIZES['0603']

// PLCC-4 LEDs as on the WS2812B-2020 and 5050: body side, height, window diameter, lead pad length and width
export const PLCC_SIZES: Record<string, { side: number; height: number; window: number; lead: [number, number] }> = {
  '2020': { side: 2.0, height: 0.84, window: 1.5, lead: [0.35, 0.55] },
  '5050': { side: 5.0, height: 1.6, window: 4.2, lead: [0.6, 1.0] },
}
