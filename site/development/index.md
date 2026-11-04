---
title: Development
description: Architecture, syntax, interfaces, exchange formats, communication and user interaction contracts for pcbjs.
---

# Development

These pages define pcbjs's system boundaries and observable contracts. Use the [Guide](/guide/getting-started/) to learn a workflow and the [command reference](/docs/cli) to operate the tools. Use Development when implementing a feature, building an integration or deciding whether behavior is correct.

## Contract sections

| Section | Questions it answers |
| --- | --- |
| [Architecture](./architecture/) | Which component owns each responsibility? How does source become a board, a snapshot and a view? |
| [Syntax and semantics](./syntax/) | Which expressions are accepted, what do they mean, and how are names, units, transforms and overrides resolved? |
| [Interfaces](./interfaces/) | What can a compiler plugin, host, viewer or query client call, and what does it receive? |
| [Exchange formats](./formats/) | What records and artifacts cross a boundary? Which fields, identities, units and versions do they use? |
| [Communication protocols](./communication/) | How do peers connect, negotiate capabilities, exchange requests, synchronize state and recover? |
| [User interaction protocols](./interaction/) | What does an operation select, reveal or change? What happens on cancellation, undo, focus loss and reconnection? |

Each section starts with scope, invariants, authoritative definitions and verification boundaries. Its detailed pages hold the field tables, syntax rules and operation contracts. A topic has one owning section even when several sections refer to it.

## Authority and interpretation

This edition defines the pcbjs 0.1.0 contracts. Earlier beta packages do not provide every API described here. The [setup guide](/guide/getting-started/npm-setup) covers the release and source-checkout workflows.

| Evidence | What it establishes |
| --- | --- |
| Specification prose | Intended semantics, ownership, preconditions and observable outcomes |
| Shared TypeScript declarations | Exact fields, unions, method parameters and result types for this checkout |
| Runtime parsers and validators | What input the implementation accepts or rejects |
| Tests and acceptance records | The behavior actually exercised on the tested candidate |

A type declaration is not a runtime validator. A test's existence is not evidence that it passed on the current candidate. A disagreement between prose, declarations and behavior is a specification or implementation defect to reconcile; do not silently invent a new compatibility promise from whichever source is convenient.

The detailed Markdown remains in `docs/` so `pcbjs docs <topic>` and this website consume the same source. Previous `/docs/<topic>` links redirect to the owning development page and preserve section anchors. The source links identify definitions in the repository; check the source revision when using documentation for a released package.

## Common vocabulary

| Term | Meaning |
| --- | --- |
| Project | A config and its registered entries, defaults and source graph |
| Entry | A module whose default export supplies a board or variants |
| Board / target | A compiled design and its selected fabrication variant |
| Run / snapshot | A compile attempt and a committed full result; a partial view compile need not mint a snapshot |
| Facet | A named subset of viewer data produced and consumed independently |
| Reference / UID / numeric ID | A resolvable entity name, a source-derived identity, and an identifier local to a compile |
| Selection / hover | Shared focus state and transient prospective highlighting; neither alone authorizes a source write |
| Instance / library layout | An instantiation's arrangement or the reusable definition from which instances are made |

Read [Conformance and compatibility](./conformance) before treating a format or interface as a long-term external contract.
