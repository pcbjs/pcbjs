// One message template per built-in rule, over a finding's measured and required values, provenance, layer and template args; see docs/findings.md.
import type { DrcMarker } from '@pcbjs/core/model'
import type { RuleProvenance, TemplateArg } from '@pcbjs/core/finding'

/** What a template reads of a finding. */
export type MessageInput = Pick<DrcMarker, 'rule' | 'layer' | 'refs' | 'measured' | 'required' | 'provenance' | 'args'>

const f3 = (v: number) => String(Math.round(v * 1000) / 1000)
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const pt = (p: TemplateArg) => `(${f3((p as number[])[0])}, ${f3((p as number[])[1])})`
const s = (m: MessageInput, k: string): string => String(m.args?.[k] ?? '')
const n = (m: MessageInput, k: string): number => Number(m.args?.[k] ?? 0)
const list = (m: MessageInput, k: string): string[] => (m.args?.[k] as string[] | undefined) ?? []
const has = (m: MessageInput, k: string): boolean => m.args?.[k] !== undefined && m.args?.[k] !== '' && m.args?.[k] !== false
/** measured and required as the rule prints them: rounded to µm, or as given */
const meas = (m: MessageInput) => f3(m.measured?.value ?? 0)
const req = (m: MessageInput) => String(m.required?.value ?? 0)
const plural = (k: number, one: string, many: string) => (k > 1 ? many : one)

/** The level that set a value, as a finding names it: `pad override of J1/3`, `part override of J1, to tracks`, `class power`; '' for the rules. */
export function provenanceText(p: readonly RuleProvenance[] | undefined): string {
  const w = p?.[0]
  if (!w) return ''
  const to = w.to === 'self' ? ', to its own pads' : w.to ? `, to ${w.to}s` : ''
  if (w.from === 'pad') return `pad override of ${w.name ?? ''}${to}`
  if (w.from === 'part') return `part override of ${w.name ?? 'its part'}${to}`
  if (w.from === 'class') return `class ${w.name ?? ''}${to}`
  return w.name ?? ''
}
const by = (m: MessageInput) => {
  const t = provenanceText(m.provenance)
  return t ? ` (${t})` : ''
}
const refAtHint = 'place them with ref:at="x y rot" or turn them off with ref:at={false}'

const TEMPLATES: Record<string, (m: MessageInput) => string> = {
  'current-width': m =>
    `${s(m, 'route')} carries ${f3(n(m, 'amps'))} A, which needs ${req(m)} mm of ${f3(n(m, 'oz'))} oz copper on ${s(m, 'layer')} for a ${n(m, 'rise')} °C rise per IPC-2152; it is ${meas(m)} mm wide`,
  'follow-unrouted': m => `${s(m, 'ref')} stays where it was drawn: ${s(m, 'route')}, which its at:follow names, has no copper to sit beside`,
  short: m => `${s(m, 'a')} (${s(m, 'an')}) touches ${s(m, 'b')} (${s(m, 'bn')}) on ${m.layer}`,
  clearance: m => `${s(m, 'a')} (${s(m, 'an')}) is ${meas(m)} mm from ${s(m, 'b')} (${s(m, 'bn')}) on ${m.layer}, closer than ${req(m)} mm${by(m)}`,
  'track-width': m =>
    `track ${s(m, 'net')} is ${m.measured?.value} mm wide, minimum ${req(m)} mm${has(m, 'pad') ? ` (${provenanceText(m.provenance)}, joining ${s(m, 'pad')})` : ''}`,
  'edge-clearance': m => `${s(m, 'a')} is closer than ${req(m)} mm to the board edge on ${m.layer}${by(m)}`,
  outline: () => 'Edge.Cuts does not form a closed outline',
  courtyard: m => `courtyards of ${s(m, 'a')} and ${s(m, 'b')} overlap`,
  unconnected: m =>
    `net ${s(m, 'net')} is not fully connected${has(m, 'apart') ? `: ${list(m, 'apart')[0]}, is apart from ${list(m, 'apart')[1]}` : ''}${has(m, 'from') ? `, from ${s(m, 'from')} to ${s(m, 'to')}` : ''}`,
  'single-pad': m => `net ${s(m, 'net')} has only one pad`,
  'copper-weight': m => {
    const layers = list(m, 'layers')
    const c = n(m, 'clearance'),
      w = n(m, 'width')
    return `${layers.join(' and ')} ${layers.length > 1 ? 'are' : 'is'} ${n(m, 'oz')} oz copper, which fabs make at clearance ${c} mm and track width ${w} mm or more, but the rules have ${list(m, 'low').join(' and ')}; raise them in rules, such as rules={{ clearance: ${c}, minTrackWidth: ${w} }}`
  },
  'thermal-spoke-width': m => `thermal spokes of ${s(m, 'pour')} are ${meas(m)} mm wide, narrower than its min width ${f3(m.required?.value ?? 0)} mm; they are kept`,
  'thermal-spokes': m => {
    const t = n(m, 'tracks')
    return `${s(m, 'pad')} (${s(m, 'net')}) joins ${s(m, 'pour')} through ${m.measured?.value} of ${n(m, 'spokes')} thermal spokes${t ? ` and ${t} ${plural(t, 'track', 'tracks')} or ${plural(t, 'via', 'vias')}` : ''}, fewer than ${req(m)}`
  },
  'via-drill': m => `${s(m, 'a')} has a ${meas(m)} mm drill, minimum via drill ${req(m)} mm`,
  drill: m => `${s(m, 'a')} has a ${meas(m)} mm drill, minimum drill ${req(m)} mm`,
  'via-size': m => `${s(m, 'a')} is ${meas(m)} mm across, minimum via diameter ${req(m)} mm`,
  'annular-ring': m =>
    `${s(m, 'a')} has a ${meas(m)} mm annular ring (${f3(n(m, 'copper'))} mm copper, ${f3(n(m, 'drill'))} mm drill), minimum ${req(m)} mm${has(m, 'plated') ? ' for plated pads' : ''}`,
  'hole-to-hole': m =>
    (m.measured?.value ?? 0) < 0
      ? `holes of ${s(m, 'a')} and ${s(m, 'b')} overlap, minimum ${req(m)} mm between hole edges${s(m, 'kind')}`
      : `holes of ${s(m, 'a')} and ${s(m, 'b')} are ${meas(m)} mm apart edge to edge, minimum ${req(m)} mm${s(m, 'kind')}`,
  'hole-to-copper': m =>
    `${s(m, 'a')} (${s(m, 'an')}) ${(m.measured?.value ?? 0) <= 0 ? 'covers' : `is ${meas(m)} mm from`} ${s(m, 'hole')} (${s(m, 'hn')}) on ${m.layer}, closer than ${req(m)} mm${by(m)}`,
  'pair-gap': m =>
    `${s(m, 'pair')}: the coupled tracks are ${meas(m)} mm apart edge to edge, the pair gap is ${f3(m.required?.value ?? 0)} mm, allowed off by ${n(m, 'tolerance')} mm`,
  'pair-skew': m =>
    `${s(m, 'pair')}: the tracks differ in length by ${meas(m)} mm, ${s(m, 'p')} ${f3(n(m, 'lengthP'))} mm and ${s(m, 'n')} ${f3(n(m, 'lengthN'))} mm with their vias, allowed ${f3(m.required?.value ?? 0)} mm${has(m, 'note') ? `; ${s(m, 'note')}` : ''}`,
  'pair-uncoupled': m => `${s(m, 'pair')}: ${meas(m)} mm of the two tracks run uncoupled at the ends and the vias, allowed ${f3(m.required?.value ?? 0)} mm`,
  length: m =>
    `${s(m, 'route')} is ${meas(m)} mm long, allowed ${s(m, 'range')}${n(m, 'tuned') ? `, ${f3(n(m, 'tuned'))} mm of it tuned` : ''}${has(m, 'note') ? `; ${s(m, 'note')}` : has(m, 'long') ? '; a route that is too long is never shortened, shorten its path or move its ends' : ''}`,
  'length-match': m =>
    `match group ${s(m, 'group')} spreads ${meas(m)} mm, allowed ${f3(m.required?.value ?? 0)} mm, ${n(m, 'below')} of ${n(m, 'count')} routes below its window: shortest ${s(m, 'lo')} at ${f3(n(m, 'loLength'))} mm${s(m, 'loAt')}, longest ${s(m, 'hi')} at ${f3(n(m, 'hiLength'))} mm${s(m, 'hiAt')}${has(m, 'note') ? `; ${s(m, 'note')}` : ''}${list(
      m,
      'caps',
    )
      .map(c => `; ${c}`)
      .join('')}`,
  'mask-web': m => `mask web between ${s(m, 'a')} and ${s(m, 'b')} on ${m.layer} is ${meas(m)} mm, narrower than ${req(m)} mm${s(m, 'more')}; the fab merges the openings`,
  'silk-width': m =>
    has(m, 'font')
      ? `${s(m, 'who')} on ${m.layer} in ${s(m, 'font')} has strokes ${meas(m)} mm wide, minimum ${req(m)} mm; set thicken on the <text>, or use a bolder font or a larger size`
      : `${s(m, 'who')} on ${m.layer} is ${meas(m)} mm wide, minimum ${req(m)} mm`,
  'silk-over-pad': m => `${s(m, 'who')} on ${m.layer} runs into the mask opening of ${s(m, 'pad')}; the fab clips it`,
  'silk-over-edge': m => `${s(m, 'who')} on ${m.layer} runs ${meas(m)} mm ${has(m, 'cutout') ? 'into a cutout' : 'past the board edge'}; the fab cuts it off`,
  'edge-courtyard': m => edgeBand(m),
  'edge-silk': m => edgeBand(m),
  'edge-pad': m => edgeBand(m),
  'cutout-outside': m => `an Edge.Cuts cutout ${has(m, 'outside') ? 'lies outside' : 'crosses'} the board outline, ${m.measured?.value} mm² of it off the board`,
  'route-failed': m =>
    has(m, 'text')
      ? s(m, 'text')
      : `cannot route ${s(m, 'leg')}net ${s(m, 'net')} from ${pt(m.args!.from)} on ${s(m, 'fromLayer')} to ${pt(m.args!.to)} on ${s(m, 'toLayer')}, layers ${list(m, 'layers').join(', ')}: ${s(m, 'reason')}${s(m, 'blocked')}${has(m, 'obstacles') && list(m, 'obstacles').length ? `; nearest obstacles: ${list(m, 'obstacles').join(', ')}` : ''}`,
  keepout: m => `${s(m, 'a')} is inside the keepout${s(m, 'keepout')} on ${m.layer}`,
  'pour-in-keepout': m => {
    const ks = list(m, 'keepouts')
    return `${s(m, 'pour')} on ${m.layer} has no fill: the ${plural(ks.length, 'keepout', 'keepouts')} ${ks.join(', ')} ${plural(ks.length, 'forbids', 'forbid')} pours there`
  },
  'net-loop': m =>
    `net ${s(m, 'net')} forms a loop${m.layer ? ` on ${m.layer}` : ' between layers'} through ${list(m, 'through').join(', ')}${s(m, 'more')}; route it as a tree, or mark it intended with .loop() on a route of the net or loops: true in its class`,
  'trunk-narrow': m =>
    has(m, 'kept')
      ? `${s(m, 'route')} joins the copper of net ${s(m, 'net')} near ${s(m, 'end')}, which stays narrower than its ${f3(n(m, 'width'))} mm: widening it would break clearance, and no path reaches ${s(m, 'end')} itself`
      : `${s(m, 'route')} runs to ${s(m, 'end')} instead of joining the copper of net ${s(m, 'net')} there: widening that copper to ${f3(n(m, 'width'))} mm would break clearance`,
  'patch-stale': m =>
    `the ${s(m, 'op')} patch of ${s(m, 'ref')} is skipped: ${has(m, 'have') ? `its target hashes ${s(m, 'have')}` : 'nothing is there'}, the patch names ${s(m, 'want')}${has(m, 'snapshot') ? `, from snapshot ${s(m, 'snapshot')}` : ''}`,
  'teardrop-dropped': m => `no teardrop where track ${s(m, 'net')} leaves ${s(m, 'pad')} on ${m.layer}: even at ${f3(n(m, 'percent'))}% it would meet ${s(m, 'why')}`,
  'stitch-empty': m => `stitch() of ${s(m, 'net')} placed no via: ${s(m, 'why')}`,
  'reference-mate': m => {
    const miss = n(m, 'miss')
    return `${s(m, 'reference')} ${s(m, 'remote')} pin ${s(m, 'pin')} lands ${f2(m.measured?.value ?? 0)} mm from the nearest pad of ${s(m, 'local')}${miss > 1 ? `, ${miss} of ${n(m, 'pins')} pins miss` : ''}${has(m, 'rotate') ? `; rotate: ${n(m, 'rotate')} lands every pin` : ''}`
  },
  'reference-net': m =>
    has(m, 'remotePin')
      ? `${s(m, 'local')} pin ${s(m, 'pin')} ${s(m, 'net')} meets ${s(m, 'reference')} ${s(m, 'remote')} pin ${s(m, 'remotePin')} ${s(m, 'remoteNet')}${has(m, 'maps') ? `; the mate maps ${s(m, 'mapsFrom')} to ${list(m, 'maps').join(' or ')}` : ''}`
      : `${s(m, 'local')} pin ${s(m, 'pin')} ${s(m, 'net')} meets no pin of ${s(m, 'reference')} ${s(m, 'remote')}`,
  'reference-collision': m => `${s(m, 'what')} ${has(m, 'body') ? 'body ' : ''}reaches ${f2(m.measured?.value ?? 0)} mm into ${s(m, 'into')}`,
  'fab-mismatch': m => {
    const what = s(m, 'what')
    const area = String(m.measured?.value ?? 0)
    if (what === 'unreadable') return `${s(m, 'gerber')} cannot be read back: ${s(m, 'error')}`
    if (what === 'outline') return `the outline read back from the Gerber differs from the board's by ${area} mm²`
    if (what === 'copper') return `${m.layer} read back from ${s(m, 'gerber')} differs from the board's copper by ${area} mm²`
    if (what === 'outside') return `${m.layer} has ${area} mm² of copper outside the board outline or inside a cutout`
    if (what === 'split') return `net ${s(m, 'net')}: pad ${s(m, 'pad')} is no longer joined to ${s(m, 'other')} in the Gerbers`
    return `nets ${s(m, 'other')} and ${s(m, 'net')} are joined in the Gerbers at pad ${s(m, 'pad')}`
  },
  'unconnected-pin': m => `${s(m, 'pin')}, ${s(m, 'label')}, is not connected: connect it to a net or to NC`,
  'single-pin-net': m => `net ${s(m, 'net')} has ${has(m, 'pin') ? `only one pin, ${s(m, 'pin')}` : 'no pins'}`,
  'net-class': m =>
    has(m, 'undefined')
      ? `net ${s(m, 'net')} has the class ${s(m, 'undefined')}, which the board does not define (classes: ${list(m, 'classes').join(', ')})`
      : `net ${s(m, 'net')} is declared with the classes ${list(m, 'classes').join(' and ')}`,
  'impedance-width': m =>
    `${s(m, 'what')} solves to ${n(m, 'width')} mm tracks${has(m, 'gap') ? ` with a ${n(m, 'gap')} mm gap` : ''} on ${m.layer}, more than twice the ${f3(n(m, 'side'))} mm pad ${s(m, 'pad')} it starts at; it leaves the pad only through a neck-down, .neck(), and fits better on a thinner prepreg such as @pcbjs/fab/JLCPCB/4-Layer-3313, see stackup-and-rules.md Impedance`,
  'unsourced-part': m => `${s(m, 'row')} has no MPN: give it MPN or MPN:<tag> with source()`,
  'unsourced-target': m => `${s(m, 'row')} has ${list(m, 'keys').join(', ')} but none for the tags ${list(m, 'tags').join(', ')} and no catch-all MPN`,
  'silk-ref': m => {
    const names = list(m, 'parts'),
      many = names.length > 1
    return `no clear spot within ${n(m, 'reach')} mm for the silk ref${many ? 's' : ''} of ${names.join(', ')}; ${refsLeftOut(many)}`
  },
  'silk-ref-hidden': m => {
    const names = list(m, 'parts'),
      many = names.length > 1
    return `no clean spot beside the courtyard${many ? 's' : ''} of ${names.join(', ')}, too small to hold ${many ? 'their refs' : 'its ref'}; ${refsLeftOut(many)}`
  },
  'model-missing': m => `${s(m, 'ref')}: model file ${s(m, 'file')} not found at ${s(m, 'path')}; the 3D view draws the generated model`,
  'sch-missing-symbol': m => {
    const what = s(m, 'what')
    if (what === 'place') return `<${s(m, 'tag')}> places ${s(m, 'part')}, which is not a part on this board`
    if (what === 'extra') return `the symbol of ${s(m, 'part')} has a pin ${s(m, 'pin')}, which ${s(m, 'part')} does not have; its pins are ${list(m, 'pins').join(', ')}`
    return `the symbol of ${s(m, 'part')} has no pin ${s(m, 'pin')}, on net ${s(m, 'net')}`
  },
  'sch-overlap': m => `the symbols of ${s(m, 'a')} and ${s(m, 'b')} overlap`,
  'sch-short': m => `a hand wire joins ${list(m, 'joins').join(' and ')}`,
  'sch-dangling': m =>
    has(m, 'label')
      ? `the ${s(m, 'label')} ${s(m, 'net')} at (${list(m, 'at').join(', ')}) is on no pin or wire`
      : `a wire${has(m, 'net') ? ` of ${s(m, 'net')}` : ''} ends at (${list(m, 'at').join(', ')}) on nothing: no pin, label or other wire`,
  'sch-unwired': m => `${s(m, 'pin')} on ${s(m, 'net')} has neither a wire nor a label`,
}

function edgeBand(m: MessageInput): string {
  const where = has(m, 'crosses') ? 'crosses the board edge' : `is ${meas(m)} mm from the board edge`
  return `${s(m, 'what')} ${where}, inside the ${req(m)} mm edge band`
}

const refsLeftOut = (many: boolean) => (many ? `they are left out, ${refAtHint}` : `it is left out, place it with ref:at="x y rot" or turn it off with ref:at={false}`)

/** The rules with a template: every built-in rule. */
export const TEMPLATE_RULES: readonly string[] = Object.keys(TEMPLATES)

/** The message of a built-in rule from its template; a plugin's rule, which has none, keeps the message it gave. */
export function messageOf(m: MessageInput & { message?: string }): string {
  const t = TEMPLATES[m.rule]
  return t ? t(m) : (m.message ?? m.rule)
}

/** A finding with its message from the template, for the checks to push. */
export const marker = (m: Omit<DrcMarker, 'message'>): DrcMarker => ({ ...m, message: messageOf(m) })
