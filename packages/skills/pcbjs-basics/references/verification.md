# Verify a board change

## Reading findings

```
    error    route-failed  F.Cu  at (12.00, 7.50)  R1, D1, J1  route:2  pcb.tsx:17:6: cannot route net LED …
```

Severity, rule, layer, position in board mm, refs, route id, the source line to edit, then the message with measured and required values. Findings come grouped by rule, causes first: fix `route-failed`, `short` and `clearance` before `unconnected`, which often follows from them. `--verbose` unfolds folded lines, `--json <file>` writes every finding with a stable id. [Common fixes](fixes.md) lists the common rules with their usual fix; `pcbjs docs findings` lists every rule.

## Cache and cold checks

`.pcbjs/cache` keeps every stage's output and, in `route/<board>.json`, every automatic leg. A warm check of an unchanged board reads its result without compiling, and an edit reroutes only the legs it touches. After a large edit, judge the board by a cold check, `pcbjs check --fresh=all`, since one rerouted leg can move others through negotiation.

## Intent kept as tests

When asked to keep a property of the design, such as a capacitor near its pin, a part on one side or a net clean, write it as a board test, never only a comment: a `*.test.ts` beside the board that reads `board()` of `@pcbjs/cli/test` and asserts with the board API. `npx pcbjs test` runs every one, `npx pcbjs check --test` after the checks, so the next edit that breaks it fails. `npx pcbjs test --update` writes goldens of the fab set, which then fail on any change to the copper.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { board } from '@pcbjs/cli/test'

test('C1 within 2 mm of U1 pin 4', () => {
  assert.ok(board().distance('C1', 'U1/4').d <= 2)
})
```

`script` [`npx pcbjs script <code>`] runs the same API once, for a question no query answers.

## Report a missing detail

When a finding made you compute something it should have said, such as a distance, a pad position or the item in the way, say which detail you computed in your answer: that message is a bug to fix in pcbjs.

Report what changed, the checks run and any material unresolved issue briefly. Do not repeat known caveats in each update or add them to board artwork. Persist a decision only where future work needs it, preferably in existing project notes; keep raw logs and routine check output out of authored board files.

## Resume a task

Use `pcbjs docs` to discover topics, then `pcbjs docs <topic> --grep <word>` for the relevant section. In an existing task note or handoff, keep only the entry/board/target, installed versions, source revision or snapshot and saved/editor authority, relevant topic links, accepted decisions/open gates, and the exact last check command plus report path/result. On resumption, confirm those identities and current edits before reusing the result. Recheck affected work if inputs changed; do not reread every entry or claim an old report validates new edits.

For a draft with reviewed findings, use the best-practices report-comparison recipe. Existing debt stays visible and ordinary check retains its failing exit.

For live reuse, retain the check report's authority/input digest, package versions and board-output digest. Pass the current session snapshot as `expectedSnapshot` to follow-up inspect/query/render calls; refresh after drift rather than treating it as a retained historical snapshot. MCP `check` uses settled reuse by default; `rebuild: 'all'` requests cold routing, and `'warm'` replays its prepared cache. Compare source identity as well as output before calling the two runs equivalent.
