import type { SiteFinding } from '@pcbjs/core/site-data'

/** Only ERC findings with sheet coordinates have schematic markers. */
export const schematicFinding = (f: SiteFinding): f is SiteFinding & { at: [number, number] } => f.layer === 'sch' && !!f.at
