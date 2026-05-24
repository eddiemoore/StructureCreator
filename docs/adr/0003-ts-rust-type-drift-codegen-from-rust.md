---
status: accepted
---

# TS↔Rust type drift: generate the TypeScript wire types from Rust

## Context

Types that cross the Tauri IPC seam — `SchemaNode`, `SchemaTree`, `Variable`, `ValidationRule`, `ValidationError`, `CreateResult`, template and recent-project records — are defined twice: as Rust structs (with serde attributes) in `apps/desktop/src-tauri/src/{schema,types,database,…}.rs`, and as hand-written TypeScript interfaces in `packages/shared/src/types.ts`. They are kept aligned by hand via serde `rename`/`rename_all`, with no test pinning the two together and no `deny_unknown_fields`, so serde silently drops unknown fields.

This has already drifted, silently. The TS `SchemaNode` carries an `attributes?: Record<string, string>` field ("preserve additional XML attributes during round-trips"); the Rust `SchemaNode` has no such field. So attributes survive in the web Target (pure TS, never touches Rust) but are silently lost whenever a node round-trips through the native Target — exactly the silent-divergence failure mode ADR-0002 forbids. This is the second cross-target consistency problem; ADR-0002 deferred it to here.

## Decision

Generate the TypeScript wire types from the Rust structs using **tauri-specta**. Rust becomes the single source of truth for every type that crosses the IPC seam; the corresponding TypeScript is a generated artifact, emitted into `packages/shared`. A field present on one side and missing on the other becomes impossible to express, so this class of drift is *prevented* at build time rather than *detected* after the fact.

- **Scope is IPC-crossing types only.** Types that never reach Rust (wizard/editor UI state and similar frontend-only types) stay hand-authored TypeScript. The seam — "does it cross IPC?" — is the boundary.
- **Rust owns the documentation.** The JSDoc currently on the hand-written TS interfaces is ported into Rust `///` doc comments so specta carries it into the generated TypeScript.
- **The current wire format is frozen.** Codegen reflects existing serde names as-is; the generated TS inherits today's mixed snake_case/camelCase naming. No serde renames are changed, so there is no risk to persisted data. Normalizing naming is explicitly out of scope and may be taken up as its own decision later.
- **Bonus: typed command bindings.** tauri-specta also generates typed bindings for the `cmd_*` commands, replacing the current stringly-typed `invoke()` calls.

## Considered options

- **Serialization golden fixtures** (the ADR-0002 mechanism, applied to types). Rejected as the primary mechanism: it only *detects* drift a fixture happens to exercise — the `attributes` bug would have slipped through unless a fixture covered it. Codegen *prevents* the entire class.
- **`#[serde(deny_unknown_fields)]` + thin fixtures.** Rejected: surfaces drift loudly but only at runtime, and rejecting unknown fields risks breaking forward-compatibility with newer payloads.
- **TypeScript as the source of truth (generate Rust).** Rejected: tooling is weak in that direction, and the wire format is already defined by Rust's serde — Rust is the natural canonical owner.

## Consequences

- **Unblocking pre-step (fixes the live bug):** flipping to codegen would regenerate the TS `SchemaNode` without `attributes`, breaking the web parser that sets it. So `attributes` must first be added to the Rust `SchemaNode` — which is correct regardless, since round-trips go through the native Target and it should preserve them. Adopting the mechanism fixes the silent-drop bug.
- The generated TS inherits inconsistent naming (e.g. `SchemaNode`'s snake_case fields alongside camelCase elsewhere). Accepted as cosmetic; correctness is unaffected.
- JSDoc now lives in Rust `///` comments; editing a wire type's docs means editing Rust.
- A codegen step joins the build, and `packages/shared`'s IPC types become generated output (should not be hand-edited).
- Migration order: reconcile Rust structs to include every legitimate wire field TS currently has (starting with `attributes`), then flip to generated types, then adopt the typed command bindings.
- This closes the type-drift half of cross-target consistency. Together with ADR-0002 (behavioural drift) and ADR-0001 (the `%NAME%` convention), the TS↔Rust seam is now pinned across types, behaviour, and the token convention.
