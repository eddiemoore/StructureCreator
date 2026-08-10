---
status: accepted
---

# One Plan module per Target; the parity contract pins production expansion

## Context

Schema-structure semantics (if/else evaluation, repeat expansion, substitution in names) were implemented five times: the Rust create walker (`structure_creator.rs`) and diff walker (`diff_preview.rs`), and three web walkers (`processNode`, `generateDiffNode`, `expand-tree.ts`). The golden-vector schema-structure contract (ADR-0002) was wired to the two surrogates — `diff_preview.rs` and `expand-tree.ts` — not to the code that ships. The walkers had already diverged: missing repeat count defaults to 1 in both production walkers but 0 in the contract surrogate; the repeat cap is 10000 (loud) in create but 100 (silent) in Rust diff; `%i_1%` and iteration-name validation exist only in the production walkers.

## Decision

Each Target gets one deep **Plan** module (see `CONTEXT.md`): `expand(tree, variables) → Plan`, pure and deterministic. The Plan is a tree of resolved nodes — names resolved, inline content fully rendered (templating then substitution), IO-dependent content deferred as `Download`/`Generate` instructions — annotated with provenance (if-branch taken, repeat iteration) for diff display. Create executes a Plan; diff preview compares a Plan against disk; dry-run prints a Plan. The golden-vector contract points at `expand` on both Targets — the shipping code, not surrogates. The TS module lives in `packages/shared`; the Rust module in `src-tauri`.

Where the walkers disagreed, the Rust create walker's semantics win, pinned by new golden vectors: missing repeat count → 1, negative/invalid count → loud error, count > 10000 → loud error, both `%i%` and `%i_1%` injected, iteration-variable name validated. Rust diff's 100-iteration truncation becomes a display-only concern in the diff view, never Plan semantics.

The caller supplies a complete variable map — built-in Variables (`%DATE%` etc.) are injected at the edge, keeping `expand` pure and contract-testable with fixed values. Post-create hooks are a native Capability and stay in the native executor, outside the Plan.

## Considered options

- **Keep surrogate walkers for the contract.** Rejected: the contract then certifies semantics production doesn't have (the missing-count divergence was live and undetected).
- **Flat path-list Plan.** Rejected: the diff UI renders a tree with if/else decision annotations; a flat list loses that provenance or forces diff to keep its own walker. Contract fixtures still consume flat paths via a trivial `toPaths(plan)` helper.
- **Structure-only Plan (content deferred).** Rejected: leaves the templating-then-substitution content ordering duplicated across create and diff walkers — half the win.
- **Keep the 100-cap in diff semantics.** Rejected: preview and create would keep disagreeing about what will happen — the silent-divergence smell relocated, not removed.

## Consequences

- `expand-tree.ts`, the web diff walker (`generateDiffNode` family), and most of `diff_preview.rs` are deleted; `diff_preview.rs` shrinks to plan-vs-disk comparison.
- New golden vectors cover the formerly divergent edges; they will fail against today's surrogates, which is the point.
- Diff preview behaviour changes user-visibly on large repeats: full plan computed (loud error past 10000) with any truncation happening only in rendering.
- Refines ADR-0002's wiring; the contract's schema-structure vectors become a spec of the Plan.
- **Follow-up (found in review, 2026-08-10):** this decision named the edge that completes the Variable map but left it unimplemented as a module, so the edge was written per caller and diverged. Native create injects Built-in Variables inside the executor while native diff preview injects none; web injects them for both but omits `%PROJECT_NAME%` from preview — so preview and create expand different maps. The edge becomes one module per Target, `complete(vars, projectName, now)`, called by every caller of `expand`, with the clock injected so a golden vector can pin it. This implements the decision above rather than changing it; `expand` stays pure and still requires a complete map.
