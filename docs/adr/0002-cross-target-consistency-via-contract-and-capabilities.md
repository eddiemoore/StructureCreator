---
status: accepted
---

# Cross-target consistency via a shared behavioural contract and an explicit capability boundary

## Context

Structure Creator has two permanently supported **Target**s (see `CONTEXT.md`): the native target (Rust backend) and the web target (TypeScript, in-browser). Both turn a Schema into a structure, and each reimplements the same behaviour independently — variable substitution and the `%NAME%` token convention, transforms (pluralize, camelCase, kebab, …), templating directives (`{{if}}` / `{{for}}`), and schema parsing. Today these live as parallel implementations (`apps/desktop/src/lib/adapters/web/*`, `packages/shared/src/templating.ts`, and `apps/desktop/src-tauri/src/{transforms,templating,schema,structure_creator}.rs`) with nothing pinning them together, so they can silently diverge.

The Targets are deliberately **not** feature-equivalent: the native target can do things the web target cannot (file downloads via `ureq`, binary processing, hooks, file watching, robust XML lexing of CDATA/namespaces via `quick_xml`). The web target's schema parser is regex-based and handles a narrower slice of XML. The danger is therefore not that the web Target lacks features — it is that the web Target silently produces a *different result* for an input both Targets claim to handle.

## Decision

Split behaviour by the line between "must be identical" and "legitimately divergent", and pin each side with a different mechanism.

**1. Shared semantic core → a language-neutral golden-vector contract.**
The pure, deterministic, dependency-free behaviour both Targets must produce identically:
- variable substitution and the `%NAME%` token convention,
- transforms (pluralize, camelCase, kebab, plural, …),
- templating directives (`{{if}}` / `{{for}}`),
- schema-structure semantics (repeat expansion, condition evaluation — given a parsed tree, what structure results).

A fixture set of `input → expected output` is checked into the repo and consumed by **both** the Rust test suite and the TS test suite. Divergence fails CI in whichever Target drifted. The contract is cheap to maintain because the covered behaviour is pure, and it is exactly where drift is silent and corrupts output (e.g. a name pluralized differently yields a different folder name).

**2. Platform-divergent layer → the existing Capability model.**
File downloads, binary processing, hooks, watch, and robust XML lexing are governed by `PlatformCapabilities` (`apps/desktop/src/lib/platform.ts`). A Target that lacks a Capability fails **loudly** (explicit error / disabled UI), as the web adapter already does for watch, team libraries, undo, and binary files. The contract deliberately does **not** cover these. Asymmetry is *declared*, not *drifted*.

**3. The schema parser straddles the line and is split accordingly.**
Schema-structure semantics stay in the contract (both Targets must agree on what a valid parsed tree means). XML *lexing robustness* becomes a Capability: the web Target supports a documented XML subset and errors explicitly on CDATA / namespaces / encodings it cannot handle, rather than mis-parsing them.

The contract covers only the capability-shared input set. Anything native-only sits behind a Capability gate that errors explicitly on the web Target.

## Considered options

- **Collapse to one implementation via WASM** (compile the Rust core to WASM, web calls it). Rejected for now: most of the native Target's superset (filesystem, network, binary) cannot run in-browser regardless, so WASM would only unify the *pure core* — which the golden-vector contract pins far more cheaply and reversibly, without adding a WASM toolchain or bundle-size cost to the web build. Kept as a future option if maintaining two copies of the pure core becomes painful.
- **Extract the shared core to TypeScript and have Rust mirror it.** Rejected: the native Target cannot easily call out to TS, so this remains two implementations while making the weaker parser the source of truth.
- **Fully contract-pin the parser** (XML → expected tree fixtures for both). Rejected: the regex web parser cannot robustly match `quick_xml` on full XML, so fixtures would be capped at what the web Target can do, artificially limiting the native Target's tested input range.
- **Leave the parser entirely platform-divergent.** Rejected: reopens silent drift on the most structural concern — the same Schema could yield different trees per Target with no test catching it.

## Consequences

- **Type drift is out of scope here.** TS↔Rust type mirroring (`SchemaNode`, `ValidationRule`, `Variable` synced by hand via serde rename) is a distinct problem with a distinct mechanism (codegen vs serialization fixtures) and is deferred to its own decision. It remains a known open risk.
- The web Target gains a **documented XML subset** and must fail loudly outside it — a small product-facing contract, not just an internal one.
- The golden-vector fixtures become the single specification of the shared core; a behavioural change must be made in both Targets and the fixtures together, or CI fails.
- The `%NAME%` token convention (ADR-0001) is part of the shared core and is covered by the contract, closing the cross-language convention-drift risk that ADR-0001 flagged as open.
