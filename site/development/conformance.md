---
title: Conformance and compatibility
description: Authority, version boundaries, evidence levels and specification change requirements.
---

# Conformance and compatibility

The Development documentation describes contracts. Conformance evidence shows which contracts were exercised on a particular implementation. These pages do not claim that every behavior has completed installed-host acceptance.

## Evidence levels

| Level | Establishes | Does not establish |
| --- | --- | --- |
| Declaration/type check | Field names, unions and call signatures agree | Runtime input validation or visible behavior |
| Unit/contract test | A focused parser, transition or method obeys its assertions | A real transport, browser or editor executes the same path |
| Integration test | Several real owners agree across a boundary | Installed-host focus, native keys or platform behavior unless included |
| Browser acceptance | DOM/canvas behavior, event handling and browser compilation on the test build | Native VS Code editor-group and document-history behavior |
| Installed-host acceptance | The packaged extension works through actual host commands and panes | Untested operating systems, lifecycle paths or later candidate changes |

Keep the candidate revision, package/extension build, platform, test command and result together. Historical passes are evidence for their tested revision, not an automatic pass for a later release candidate.

## Verification map

| Contract | Representative evidence |
| --- | --- |
| Syntax and samples | `packages/pcbjs/tests/docs-samples.test.mjs`, `site-samples.test.mjs`; compiler/parser suites |
| Canonical model and facets | `packages/pcbjs/tests/site-facets.test.mjs`; stage/cache and export suites |
| Browser parity | `packages/pcbjs/tests/browser-equality.test.mjs`, `browser-compile.test.mjs` |
| Transport and shared selection | `packages/cli/tests/protocol.test.mjs`, `selection-state.test.mjs`, `finding-focus.test.mjs` |
| Focus/camera transactions | `packages/ui/tests/focus-transaction.test.mjs`, `focus-transaction-browser.test.mjs` |
| UI inventory | `scripts/ui-contracts.json`, `packages/ui/tests/ui-contracts.test.mjs` |
| Editor inventory and lifetime | `scripts/vscode-contracts.json`, `packages/vscode/tests/contracts.test.mjs`, `lifecycle.test.mjs` |
| Documentation navigation and isolation | Site specification, guide, browser and local-report tests |

Inventories record source/test traceability and remaining acceptance. A command appearing in an inventory does not mean that its end-to-end behavior passed. Consult [Testing](/docs/testing) and [Development](./architecture/development) for running checks, and keep unpublished candidate results in local review reports.

## Compatibility mechanisms

| Surface | Current mechanism | Constraint |
| --- | --- | --- |
| Session/editor protocol | `PROTOCOL` and `MAJOR`, negotiated capabilities, `compat()` | Additive fields do not grant new permissions; incompatible majors cannot assume the full extension contract |
| Browser module | Its own `format` field | Independent of session protocol version |
| Source/API packages | Package versions, exported types and documented behavior | An internal helper is not automatically a supported public API |
| Stage/route/model caches | Compiler identities, cache keys and format-specific revisions | Generated caches are disposable implementation data, not stable user-authored interchange |
| Fabrication formats | Exporter-specific encoding, precision, units and validation | A valid container is not proof of circuit correctness or complete manufacturing review |

There is no complete language-neutral schema registry for every record today. Exact record shapes are primarily declared in TypeScript, with runtime checks at individual boundaries. Version 0.1.0 does not promise broader format stability or validation coverage than its declarations and tests establish.

## Updating a contract

1. Identify the owning section, shared declaration and relevant operation/format identity.
2. Specify preconditions, result, side effects, invalid input and failure behavior. Include cancellation, ordering and reconnection where applicable.
3. Change the shared contract once and adapt its producers and consumers. Review whether the relevant compatibility mechanism must change.
4. Update the detailed Markdown in `docs/` and the section overview when the boundary changes. Keep examples executable and source-linked previews truthful.
5. Add or update tests at the boundary that can actually fail. Record any remaining browser or installed-host acceptance separately.
6. Retain canonical links and old topic compatibility routes when reorganizing documentation.

When prose and implementation disagree, record the discrepancy and reconcile it. Do not use a test that only repeats the implementation to declare an unresolved contract correct.
