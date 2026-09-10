# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

The repository contains **no code yet** — only `f1-manager-plan.md` (Russian, ~790 lines), the full design and development spec for a browser-based Formula 1 team-manager game. The plan is the source of truth: read the relevant section before implementing anything, and treat section 10 ("Зафиксированные решения") as fixed — those decisions change only via a new ADR, not by inference during implementation.

Work proceeds strictly milestone by milestone (M0 → M12, section 7). Do not start the next milestone until the current one passes its Definition of Done. The user's typical task framing is "implement milestone MN from the plan".

## Non-negotiable invariants

These come from plan section 0 and are the reason the architecture looks the way it does. Violating any of them silently breaks tests, replays, and balancing.

1. **`src/sim/` is pure TypeScript.** No React imports, no `Math.random()`, and no JS `Date` at all — not even deterministic `Date.UTC`; the game calendar (`GameDate`) is the sim's own day index. Only the passed-in seed and the passed-in game time. Enforced on every edit by `.claude/hooks/check-sim-purity.sh`; record the `GameDate` representation in the M0 ADR.
2. **Determinism.** One seed per playthrough, with *named substreams* (`rng('race:2027:monza:incidents')`) so adding a new system never shifts randomness in existing ones. `simulateRace(input: RaceInput): RaceResult` is a pure function — same input, byte-identical output.
3. **`Estimate<T>` is the only way uncertainty reaches the player** (section 4.1). Truth lives in world state; estimates are produced by `observe(truth, precision, rng)` and narrowed by `refine(prior, observation)`. Truth must never be embedded in an `Estimate`. Precision has two independent parts: *spread* (interval width) and *bias* (systematic error, never displayed). Estimates are computed at defined moments (session end, day tick, R&D stage) and **stored in state** — never recomputed on render.
4. **One `decide()` contract for player delegates and rival-team AI** (section 5.19): `decide<TContext, TDecision>(context, competence, intent, rng)`. There is no separate "AI logic" — rivals call the same function with their staff's parameters. Fixed in M1, before the first decision-making system.
5. **Balance constants live in `src/data/balance/*.json`**, each value commented — never hardcoded in logic.
6. **Content is data, not code.** Tracks, teams, drivers, car parts load from JSON packs validated by Zod, so players can substitute their own. The default pack is fictional (recognizable archetypes, not real names); no realistic/licensed pack goes in the repo.
7. **A design-note in `docs/systems/` precedes any large system.** Every milestone ends with Vitest tests, a short `docs/adr/NNN-*.md`, and a `docs/CHANGELOG.md` update.
8. **UI screens are built against mock data first**, then wired to state. All uncertain values render through the single `Estimate` display component (section 6.6).

## Planned architecture

Stack (section 3.1): React 19 + TS strict, Vite, Zustand + Immer, TanStack Router, Tailwind + CSS variables, Radix primitives, D3-scale/shape with hand-rolled SVG (no d3-selection), Recharts, Motion, Comlink + Web Worker, Dexie (IndexedDB saves), seedrandom or a custom PCG32, Zod, Vitest + Testing Library. No backend, no online play in v1; desktop-first (min 1280×800); ru + en via i18n from day one.

Layering (section 3.2) — the dependency direction is one-way, `sim` ← `app` ← `ui`:

- `src/sim/` — engine, race, season, car, people, finance, media, ai, rng, types. The whole game runs here, headless.
- `src/data/` — `packs/default/`, `balance/`, `schema/` (Zod).
- `src/app/` — Zustand slices, the Web Worker wrapper, save serialization + version migrations. This is the only bridge between sim and UI.
- `src/ui/` — `design/` tokens and primitives, `screens/`, `widgets/`.
- `docs/adr/`, `docs/systems/`, `docs/calibration/`.

Simulation runs in a Web Worker from M2 onward; the UI only draws.

**Two time scales** (section 3.4): between races, one tick = one day. During a race weekend, sessions run by lap with per-sector segments, played back at ×1/×2/×5/×15 with pause and intervention.

## Testing and balancing

- Unit tests per simulation formula.
- **Determinism tests**: seed + input → fixed result hash, so unintended logic changes fail loudly.
- **Batch runs are the primary balancing tool** — `npm run sim:batch -- --seasons 100` emitting CSV statistics (champion distribution, average gaps, SC frequency, strategy spread). Calibration targets are numeric and specified per milestone (e.g. M2: top-to-backmarker gap ≈2–3%, driver lap scatter ≈0.2–0.4 s, soft-tyre deg ≈0.08–0.15 s/lap, SC in ~40% of races). M2 must produce `docs/calibration/M2.md` before any race UI exists.
- Save snapshots for migration tests.
- Performance budget: full headless race < 200 ms; race rendering holds 60 FPS at ×15.

## Commands

None yet — M0 scaffolds the Vite project, ESLint/Prettier, Vitest, folder structure, design tokens, routing, and i18n. When creating it, wire up at minimum `dev`, `build`, `test` (Vitest), `lint`, and the `sim:batch` script the plan's balancing workflow depends on, then replace this section with the real commands including how to run a single test.
