# Project testing policy

Tests protect PCB correctness and the documented user contract. Prioritize generated geometry, connectivity, routing, DRC/ERC, fabrication output, source edits, synchronized preview state, and editor/session lifecycle. Security and data-loss boundaries are part of that contract.

- A feature or optimization does not automatically need a new test. Add one only for a meaningful failure that existing coverage cannot catch.
- Prefer a small representative case at the lowest useful layer. Reuse fixtures and extend an existing scenario instead of creating another server, browser, board matrix, or end-to-end harness.
- Assert observable results. Avoid source-text assertions, private implementation details, exhaustive combinations, and duplicated unit/integration/browser coverage of the same behavior.
- Performance benchmarks and profiling are opt-in diagnostics, not correctness or release gates. Do not block a release on millisecond limits, frame scheduling, incidental cache counts, or runner load.
- Keep the default suite small and fast. Remove superseded or redundant tests when behavior changes. Run the affected checks first; run the full correctness suite once for a release candidate, with focused compatibility checks on other runtimes and operating systems.
- Release validation reuses passing checks for the exact source commit and verifies the versioned installable artifacts. Do not repeat the full source suite in dry-run and publishing jobs.
- Isolate temporary files, caches, ports, and processes. A correctness failure must be diagnosed and fixed; do not hide it with retries, blanket skips, or weakened assertions.

Keep code and documentation concise. Build before testing code that imports `dist`; never edit generated output. Do not run formatters manually: the commit hook formats staged changes.
