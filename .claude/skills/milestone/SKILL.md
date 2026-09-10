---
name: milestone
description: Implement one milestone (M0–M12) of f1-manager-plan.md end to end — design-note, model, tests, UI, ADR, changelog, DoD check. Use when the user asks to implement, start, or continue a milestone.
argument-hint: "[M0-M12]"
---

Implement milestone **$ARGUMENTS** from `f1-manager-plan.md`, following the rules in plan section 0 and the invariants in CLAUDE.md.

If no milestone was given, take the one after the last entry in `docs/CHANGELOG.md` (M0 if there is none) and confirm it with the user.

## 1. Gate

- Check that the previous milestone is recorded as done in `docs/CHANGELOG.md` with its DoD met. If it isn't, stop and report what is missing — do not start this milestone.
- Read the milestone's entry in plan section 7, every plan section it references (e.g. 4.1, 5.4, 5.19), plus sections 0 and 10. Read the existing `docs/adr/` and `docs/systems/` notes for systems this milestone touches.

## 2. Design-note first

For each large system in the milestone, write a 0.5–1 page note in `docs/systems/<system>.md`: the model, its inputs and outputs, where randomness enters (named `rng(...)` streams), which values the player sees as `Estimate<T>`, which decisions go through `decide()`, and which constants go to `src/data/balance/`. Show the notes to the user and get agreement before writing code.

Write docs in the language already used in `docs/`. If `docs/` is empty, ask the user once which language to use.

## 3. Build, in this order

1. Domain types and data (`src/sim/types/`, Zod schemas, pack JSON, balance JSON with a comment on every value).
2. Simulation logic in `src/sim/` — pure, seeded, no wall-clock time.
3. Tests (Vitest): unit tests per formula, a determinism test (seed + input → fixed hash) for any new seeded process, and one test per DoD item that can be expressed as a test.
4. UI, if the milestone has any: screen against mock data first, then wire it through `src/app/store/`. Uncertain values render only through the shared Estimate component.

## 4. Verify

- Run typecheck, lint, and the full test suite; all must pass.
- Invariant check over the diff: no `Math.random`/`Date.now`/React in `src/sim/`; no hardcoded balance numbers in logic; no truth leaking into an `Estimate`; no player-only or AI-only decision path that bypasses `decide()`; content lives in packs, not code.
- Go through the DoD line by line and attach evidence to each item: a test name, a report file (e.g. `docs/calibration/M2.md`), or a command and its output. Any item without evidence means the milestone is not done.

## 5. Close out

- `docs/adr/NNN-<slug>.md` (next free number): the decisions made during this milestone and the alternatives rejected.
- `docs/CHANGELOG.md`: an entry for the milestone.
- If commands or structure changed, update the relevant sections of CLAUDE.md.

## 6. Report to the user

Briefly: what was built, the decisions made (with ADR links), any deviations from the plan and why, the DoD evidence per item, and open questions for the next milestone. If any DoD item failed, lead with that.
