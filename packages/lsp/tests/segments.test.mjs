// The segments of a file without a server: the vocabulary each literal maps to, the edits the presentations carry, the
// path commands edited one by one inside their own text, typed values, and the downgrade for an older client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { segmentsOf, typedSegment } from '../dist/segments.js';
import { forClient, negotiate, KINDS } from '../dist/protocol.js';

const text = readFileSync(new URL('./fixtures/main.tsx', import.meta.url), 'utf8');
const apply = (t, e) => t.slice(0, e.start) + e.newText + t.slice(e.end);
const ctx = {
  layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'Edge.Cuts'],
  pads: (ref) => (ref === 'Q1' ? [{ num: '1', name: 'G', net: 'SIG' }, { num: '2', name: 'S', net: 'GND' }, { num: '3', name: 'D', net: 'SW' }] : undefined),
};
const segs = segmentsOf(text, 'main.tsx', ctx);
const at = (value, kind) => segs.find((s) => s.value === value && (!kind || s.kind === kind));

test('every literal maps to a kind of the vocabulary', () => {
  for (const s of segs) assert.ok(KINDS.includes(s.kind), s.kind);
  assert.equal(at('3 7.46').kind, 'position');
  assert.equal(at('B', 'enum').label, 'C1 side');
  assert.equal(at('F.SilkS', 'layer').kind, 'layer');
  assert.equal(at('0.25').kind, 'length');
  assert.equal(at('2', 'enum').label, 'PCB copper');
  assert.deepEqual(segs.filter((s) => s.constraints.grammar === 'route').map((s) => s.value), ['V 14', 'L 5 16', '@B.Cu', 'H 24', 'V 7.5', '@F.Cu', 'XZ']);
  for (const s of segs) assert.equal(text.slice(s.start, s.end), s.value);
});

test('presentations carry edits: a nudge, a turn, a layer, a flip, a width step', () => {
  const pos = at('3 7.46');
  assert.equal(apply(text, pos.presentations.find((p) => p.detail === 'x +0.1 mm').edit).includes('at="3.1 7.46"'), true);
  assert.equal(pos.presentations.find((p) => p.detail === 'turn 90° counter-clockwise').edit.newText, '3 7.46 90');
  assert.ok(at('F.SilkS', 'layer').presentations.some((p) => p.edit.newText === 'B.SilkS'));
  // a route layer offers copper only
  assert.deepEqual(at('B.Cu', 'layer').presentations.map((p) => p.label), ['F.Cu']);
  assert.deepEqual(at('B', 'enum').presentations.map((p) => p.edit.newText), ['F']);
  const w = at('0.25');
  assert.deepEqual(w.presentations.slice(0, 2).map((p) => [p.edit.newText, p.detail]), [['0.2', '-0.05 mm'], ['0.3', '+0.05 mm']]);
  assert.deepEqual([w.constraints.min, w.constraints.max, w.constraints.unit], [0.1, 2, 'mm']);
});

test('path commands: each edit stays inside its command and keeps the path valid', () => {
  const v = at('V 14', 'pathCommand');
  const toL = v.presentations.find((p) => p.label.startsWith('L '));
  assert.ok(toL && toL.edit.start === v.start && toL.edit.end === v.end);
  // deleting the end would break the route: not offered
  const end = at('XZ', 'pathCommand');
  assert.ok(!end.presentations.some((p) => p.label === 'delete'));
  assert.equal(apply(text, end.presentations.find((p) => p.edit.newText === 'Z').edit).includes("'V 14 L 5 16 @B.Cu H 24 V 7.5 @F.Cu Z'"), true);
  const via = at('@B.Cu', 'pathCommand');
  assert.deepEqual(via.presentations.map((p) => p.edit.newText), ['@F.Cu', '']);
  const del = apply(text, via.presentations.find((p) => p.label === 'delete').edit);
  assert.ok(del.includes("'V 14 L 5 16 H 24 V 7.5 @F.Cu XZ'"));
  const svg = segs.find((s) => s.constraints.grammar === 'svg' && s.value === 'V 15');
  assert.ok(svg.presentations.some((p) => p.edit.newText === 'H 15'));
});

test('pad references: the other pads of the part, with their nets', () => {
  const q = segs.filter((s) => s.kind === 'pinRef' && s.value === '1')[0];
  assert.deepEqual(q.presentations.map((p) => [p.label, p.detail, p.edit.newText]), [['Q1.2', 'S · GND', '2'], ['Q1.3', 'D · SW', '3']]);
  const j = segs.find((s) => s.kind === 'pinRef' && s.value === '3');
  assert.deepEqual(j.presentations, [], 'a part the board does not know offers nothing');
});

test('typed values: written in the unit and grammar of the literal, or refused with a reason', () => {
  const off = (needle, d = 0) => text.indexOf(needle) + d;
  assert.equal(typedSegment(text, 'main.tsx', ctx, off("'V 14", 2), 'V 15').presentations[0].edit.newText, 'V 15');
  assert.match(typedSegment(text, 'main.tsx', ctx, off("'V 14", 2), 'M 1 2').error, /leave out M/);
  assert.equal(typedSegment(text, 'main.tsx', ctx, off('0.25'), '10mil').presentations[0].edit.newText, '0.254');
  assert.match(typedSegment(text, 'main.tsx', ctx, off('0.25'), 'wide').error, /not a length/);
  assert.equal(typedSegment(text, 'main.tsx', ctx, off('"3 7.46', 1), '4 8 180').presentations[0].edit.newText, '4 8 180');
  assert.match(typedSegment(text, 'main.tsx', ctx, off('"3 7.46', 1), '4').error, /x y/);
  assert.match(typedSegment(text, 'main.tsx', ctx, off('layer="F.SilkS', 8), 'In9.Cu').error, /not a layer/);
  assert.match(typedSegment(text, 'main.tsx', ctx, off('Q1[1]', 3), '7').error, /Q1 has no pad 7/);
});

test('handshake: kinds per client version, unknown kinds as enum', () => {
  assert.deepEqual(negotiate(undefined, '1.0').kinds, [...KINDS]);
  assert.deepEqual(negotiate({ protocol: 1, kinds: ['length', 'enum', 'nope'] }, '1.0').kinds, ['length', 'enum']);
  assert.equal(negotiate({ protocol: 99 }, '1.0').protocol, 2);
  assert.deepEqual(negotiate({ protocol: 1, kinds: ['length'], capabilities: ['widget'] }, '1.0').kinds, ['length'], 'widget needs protocol 2');
  const cmd = { range: null, kind: 'pathCommand', value: 'V 14', label: 'x', constraints: { grammar: 'route' }, presentations: [] };
  assert.deepEqual(forClient(cmd, ['enum']), { ...cmd, kind: 'enum', constraints: {}, widget: { input: 'enum', typed: false } });
  assert.equal(forClient(cmd, ['length']), undefined);
  assert.equal(forClient(cmd, ['pathCommand']), cmd);
});

test('route chains: examples/demo/blinky.pcb.tsx, each call a pathCommand with edits of its own', () => {
  const demo = readFileSync(new URL('../../../examples/demo/blinky.pcb.tsx', import.meta.url), 'utf8');
  const segs = segmentsOf(demo, 'blinky.pcb.tsx', { layers: ['F.Cu', 'B.Cu'] });
  const chain = segs.filter((s) => s.constraints.grammar === 'chain');
  assert.deepEqual(chain.map((s) => s.value), ['V(14)', 'L(5, 16)', "via('B.Cu')", 'H(24)', 'V(7.5)', "via('F.Cu')", 'X(Q1[1])', "X('25 12.5 B.Cu')"]);
  for (const s of chain) assert.equal(s.kind, 'pathCommand');
  const v = chain[0];
  assert.ok(v.presentations.some((p) => p.edit.newText === 'H(14)'));
  // delete takes the dot with it
  const del = v.presentations.find((p) => p.label === 'delete');
  assert.equal(apply(demo, del.edit).includes('route(J1[3]).L(5, 16)'), true);
  assert.deepEqual(chain[2].presentations.map((p) => p.edit.newText), ["via('F.Cu')", '']);
  assert.deepEqual(chain[6].presentations.map((p) => p.edit.newText), ['Z(Q1[1])']);
  const at = demo.indexOf('.V(14)') + 2;
  assert.equal(typedSegment(demo, 'blinky.pcb.tsx', {}, at, 'V(15)').presentations[0].edit.newText, 'V(15)');
  assert.equal(typedSegment(demo, 'blinky.pcb.tsx', {}, at, 'l 1 2').presentations[0].edit.newText, 'l(1, 2)');
  assert.equal(typedSegment(demo, 'blinky.pcb.tsx', {}, at, '@In1.Cu').presentations[0].edit.newText, "via('In1.Cu')");
  assert.equal(typedSegment(demo, 'blinky.pcb.tsx', {}, at, 'V 10mil').presentations[0].edit.newText, "V('10mil')");
  assert.match(typedSegment(demo, 'blinky.pcb.tsx', {}, demo.indexOf('X(Q1') + 1, 'H 3').error, /ends the route/);
  // the pad of the end is a pinRef inside the call, and wins at its position
  const q = segs.filter((s) => s.kind === 'pinRef').map((s) => s.value);
  assert.ok(q.includes('1') && q.includes('3'));
});
