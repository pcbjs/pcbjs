// The repair pass of a draft: each broken input, what it skips or closes, and that every kept offset is the overlay's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repair, toOverlay } from '../dist/repair.js';

const PCB = (body) => `export default <PCB>\n${body}\n</PCB>\n`;

// [name, overlay, the skipped text, the closers inserted]
const table = [
  ['unterminated string', `const a = 'abc\n${PCB('  <R1 at="1 2" />')}`, ["const a = 'abc"], ''],
  ['unterminated string at the end', `export default <PCB><R1 at="1 2`, [], '"/></PCB>'],
  ['open JSX tag mid-typing', PCB('  <R1 at="1 2" />\n  <C1 at="3 4"'), ['<C1 at="3 4"'], ''],
  ['open JSX tag at the end', `export default <PCB>\n  <R1 at="1 2" />\n  <C1 at="3 4"`, [], '/></PCB>'],
  ['dangling route(U1.VSSA).h( call', PCB('  {route(U1.VSSA).h(}\n  <R1 at="1 2" />'), ['{route(U1.VSSA).h(}'], ''],
  ['dangling call at the end', `const x = 1\nroute(U1.VSSA).h(`, [], ')'],
  ['dangling call in a function', `function f() {\n  route(U1.VSSA).h(\n  return 1\n}\n`, ['route(U1.VSSA).h('], ''],
  ['half-typed object property', `const o = { width: 0.3, d: }\n${PCB('')}`, ['d:'], ''],
  ['extra closing brace', `function f() {\n  return 1\n}}\n${PCB('')}`, ['}'], ''],
  ['half-typed attribute', PCB('  <R1 at= />'), ['at='], ''],
  ['element closed nowhere', PCB('  <R1 at="1 2">\n  <C1 />'), ['<R1 at="1 2">'], ''],
  ['half-typed member', PCB('  {route(U1.).h(3)}'), ['{route(U1.).h(3)}'], ''],
];

for (const [name, text, skipped, closers] of table) {
  test(`repair: ${name}`, () => {
    const r = repair(text, 'pcb.tsx');
    assert.ok(r.ok, r.text);
    assert.deepEqual(r.skipped.map((s) => text.slice(s.start, s.end)), skipped);
    const cut = r.limit ?? text.length;
    assert.equal(r.text.length - text.length, closers.length);
    if (closers) assert.ok(r.text.slice(r.limit).startsWith(closers), r.text);
    // nothing before the closers moves: each character is the overlay's, or a blank inside a skipped span
    for (let i = 0; i < cut; i++) {
      const inSkip = r.skipped.some((s) => i >= s.start && i < s.end);
      assert.equal(r.text[i], inSkip && !/[\r\n]/.test(text[i]) ? ' ' : text[i], `offset ${i}`);
    }
  });
}

test('repair: a text that parses comes back as it is', () => {
  const text = PCB('  <R1 at="1 2" />');
  assert.deepEqual(repair(text, 'pcb.tsx'), { text, skipped: [], limit: null, ok: true });
});

test('repair: an offset another parser rejected is skipped as a syntax error', () => {
  const text = `const a = 1\nconst b = 2\n`;
  const r = repair(text, 'pcb.ts', [text.indexOf('b')]);
  assert.ok(r.ok);
  assert.deepEqual(r.skipped.map((s) => text.slice(s.start, s.end)), ['const b = 2']);
});

test('repair: more broken statements than the rounds allow stays broken', () => {
  const text = Array.from({ length: 6 }, (_, i) => `const v${i} = (\n;`).join('\n');
  const r = repair(text, 'pcb.ts');
  assert.equal(r.ok, false);
  assert.equal(r.skipped.length, 4);
});

test('toOverlay: an offset in the closers maps to the last character of the overlay', () => {
  const text = `const x = 1\nroute(U1.VSSA).h(`;
  const r = repair(text, 'pcb.ts');
  assert.equal(toOverlay(r, r.text.length - 1), text.length - 1);
  assert.equal(toOverlay(r, 3), 3);
});
