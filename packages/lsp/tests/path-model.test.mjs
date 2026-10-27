// The path editor's model: parse to rows, edit rows, serialise, validate against the route grammar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../dist/path-model.js';

/** The rows without their text spans. */
const bare = (rows) => rows.map(({ cmd, args }) => ({ cmd, args }));

const SIG = 'V 14 L 5 16 @B.Cu H 24 V 7.5 @F.Cu XZ';

test('parse a route path into one row per command', () => {
  const { rows, errors } = P.parsePath(SIG, 'route');
  assert.deepEqual(errors, []);
  // each row knows its text in the string
  assert.deepEqual(rows.map((r) => SIG.slice(r.start, r.end)), ['V 14', 'L 5 16', '@B.Cu', 'H 24', 'V 7.5', '@F.Cu', 'XZ']);
  assert.deepEqual(bare(rows), [
    { cmd: 'V', args: ['14'] },
    { cmd: 'L', args: ['5', '16'] },
    { cmd: '@', args: ['B.Cu'] },
    { cmd: 'H', args: ['24'] },
    { cmd: 'V', args: ['7.5'] },
    { cmd: '@', args: ['F.Cu'] },
    { cmd: 'XZ', args: [] },
  ]);
  assert.equal(P.serialise(rows), SIG);
  assert.deepEqual(P.validate(rows, 'route'), []);
  assert.equal(P.ending(rows), 'XZ');
});

test('parse the other spellings: relative forms, X Z, @ with a space, U, implicit repeats, commas', () => {
  const { rows, errors } = P.parsePath('l 1,2 3 4 h -1 v.5 x 2 2 @ bottom U top X Z', 'route');
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => [r.cmd, ...r.args].join(' ')), ['l 1 2', 'l 3 4', 'h -1', 'v .5', 'x 2 2', '@ bottom', '@ top', 'XZ']);
  assert.equal(P.serialise(rows), 'l 1 2 l 3 4 h -1 v .5 x 2 2 @bottom @top XZ');
  assert.deepEqual(P.validate(rows, 'route'), []);
  assert.deepEqual(P.parsePath('', 'route').rows, []);
  const odd = 'l 1,2 3 4 h -1';
  assert.deepEqual(P.parsePath(odd, 'route').rows.map((r) => odd.slice(r.start, r.end)), ['l 1,2', '3 4', 'h -1']);
  assert.deepEqual(P.validate([], 'route'), [], 'an empty route path means XZ');
});

test('edit rows: set an argument, change a command, insert, delete, layers and the end toggle', () => {
  let rows = P.parsePath(SIG, 'route').rows;
  rows = P.setArg(rows, 1, 0, '6');
  assert.equal(P.serialise(rows), 'V 14 L 6 16 @B.Cu H 24 V 7.5 @F.Cu XZ');
  rows = P.setLayer(rows, 2, 'In1.Cu');
  assert.equal(P.serialise(rows), 'V 14 L 6 16 @In1.Cu H 24 V 7.5 @F.Cu XZ');
  // Insert after the L: an absolute command starts at the cursor, which the L made known.
  rows = P.insertRow(rows, 1, 'H', 'route');
  assert.equal(P.serialise(rows), 'V 14 L 6 16 H 6 @In1.Cu H 24 V 7.5 @F.Cu XZ');
  // Before the L the cursor is unknown, the hidden M is at a: zeros.
  assert.equal(P.serialise(P.insertRow(rows, -1, 'L', 'route')), 'L 0 0 V 14 L 6 16 H 6 @In1.Cu H 24 V 7.5 @F.Cu XZ');
  // An insert after the end goes before it.
  assert.equal(P.serialise(P.insertRow(rows, rows.length - 1, '@', 'route')).endsWith('@F.Cu @B.Cu XZ'), true);
  rows = P.deleteRow(rows, 2);
  assert.equal(P.serialise(rows), 'V 14 L 6 16 @In1.Cu H 24 V 7.5 @F.Cu XZ');
  // H to L keeps x and fills y from the cursor; L to V keeps y.
  assert.equal(P.serialise(P.setCommand(rows, 3, 'L', 'route')), 'V 14 L 6 16 @In1.Cu L 24 16 V 7.5 @F.Cu XZ');
  assert.equal(P.serialise(P.setCommand(rows, 1, 'V', 'route')), 'V 14 V 16 @In1.Cu H 24 V 7.5 @F.Cu XZ');
  assert.equal(P.serialise(P.setCommand(rows, 1, 'X', 'route')), 'V 14 X 6 16 @In1.Cu H 24 V 7.5 @F.Cu XZ');
  rows = P.toggleEnd(rows);
  assert.equal(P.ending(rows), 'Z');
  assert.equal(P.serialise(rows), 'V 14 L 6 16 @In1.Cu H 24 V 7.5 @F.Cu Z');
  assert.equal(P.serialise(P.toggleEnd(rows)), 'V 14 L 6 16 @In1.Cu H 24 V 7.5 @F.Cu XZ');
  // A path without an end gets XZ.
  assert.equal(P.serialise(P.toggleEnd([{ cmd: 'H', args: ['3'] }])), 'H 3 XZ');
});

test('validation: curves, M, the ending rule, bad numbers and bad layers', () => {
  const v = (s) => P.validate(P.parsePath(s, 'route').rows, 'route');
  assert.match(v('C 1 2 3 4 5 6 Z')[0], /row 1: C is a curve/);
  assert.match(v('A 1 1 0 0 1 2 2 XZ')[0], /curve/);
  assert.match(v('M 1 2 XZ')[0], /starts at a, leave out M/);
  assert.match(v('H 3').join(), /must end at b, with Z .* or XZ/);
  assert.match(v('H 3 Z V 2 XZ').join(), /row 2: Z ends the route at b, nothing may follow it/);
  assert.match(P.validate([{ cmd: 'L', args: ['1', 'x'] }, { cmd: 'Z', args: [] }], 'route').join(), /argument 2 of L is not a number/);
  assert.match(P.validate([{ cmd: '@', args: ['B'] }, { cmd: 'XZ', args: [] }], 'route').join(), /@ needs a layer/);
  // Deleting the end breaks the ending rule, so the editor would not write it.
  const rows = P.parsePath(SIG, 'route').rows;
  assert.match(P.validate(P.deleteRow(rows, rows.length - 1), 'route').join(), /must end at b/);
  // The lenient reader reports what it could not read.
  assert.match(P.parsePath('L 1', 'route').errors.join(), /L expects 2 numbers, found 1/);
  assert.match(P.parsePath('@ XZ', 'route').errors.join(), /needs a layer/);
  assert.match(P.parsePath('H 1 ; Z', 'route').errors.join(), /unexpected ";"/);
});

test('svg path data: M first, curves allowed, route commands rejected, implicit L after M', () => {
  const { rows, errors } = P.parsePath('M 0 0 10 0 V 5 A 1 1 0 0 1 2 2 Z', 'svg');
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => r.cmd), ['M', 'L', 'V', 'A', 'Z']);
  assert.deepEqual(P.validate(rows, 'svg'), []);
  assert.equal(P.serialise(rows), 'M 0 0 L 10 0 V 5 A 1 1 0 0 1 2 2 Z');
  assert.match(P.validate(P.parsePath('H 3', 'svg').rows, 'svg').join(), /starts with M/);
  assert.match(P.validate([{ cmd: 'M', args: ['0', '0'] }, { cmd: '@', args: ['B.Cu'] }], 'svg').join(), /belongs to route paths/);
  // Insert after a row uses the absolute cursor.
  assert.equal(P.serialise(P.insertRow(P.parsePath('M 3 10 H 9', 'svg').rows, 1, 'V', 'svg')), 'M 3 10 H 9 V 10');
  assert.ok(P.commands('svg').includes('C'));
  assert.ok(!P.commands('route').includes('C'));
});
