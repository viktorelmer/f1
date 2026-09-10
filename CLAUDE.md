# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`f1-manager-plan.md` (Russian, ~790 lines) is the full design and development spec for a browser-based Formula 1 team-manager game. The plan is the source of truth: read the relevant section before implementing anything, and treat section 10 ("Зафиксированные решения") as fixed — those decisions change only via a new ADR, not by inference during implementation.

Work proceeds strictly milestone by milestone (M0 → M12, section 7). Do not start the next milestone until the current one passes its Definition of Done. The user's typical task framing is "implement milestone MN from the plan" (the `/milestone` skill). Progress is recorded in `docs/CHANGELOG.md`; **M0 (scaffold) is done** — see `docs/adr/001-m0-scaffold.md`. All docs (`docs/`) are written in Russian.

## Non-negotiable invariants

These come from plan section 0 and are the reason the architecture looks the way it does. Violating any of them silently breaks tests, replays, and balancing.

1. **`src/sim/` is pure TypeScript.** No React imports, no `Math.random()`, and no JS `Date` at all — not even deterministic `Date.UTC`; the game calendar is `GameDate` (`src/sim/types/game-date.ts`), an integer day count since 1970-01-01 (ADR 001). Only the passed-in seed and the passed-in game time. Enforced three ways: `.claude/hooks/check-sim-purity.sh` on every edit, ESLint layering rules (tested in `tests/eslint-layers.test.ts`), and `tsconfig.sim.json`, which type-checks `src/sim/` without DOM types.
2. **Determinism.** One seed per playthrough, with *named substreams* (`rng('race:2027:monza:incidents')`) so adding a new system never shifts randomness in existing ones. `simulateRace(input: RaceInput): RaceResult` is a pure function — same input, byte-identical output.
3. **`Estimate<T>` is the only way uncertainty reaches the player** (section 4.1). Truth lives in world state; estimates are produced by `observe(truth, precision, rng)` and narrowed by `refine(prior, observation)`. Truth must never be embedded in an `Estimate`. Precision has two independent parts: *spread* (interval width) and *bias* (systematic error, never displayed). Estimates are computed at defined moments (session end, day tick, R&D stage) and **stored in state** — never recomputed on render.
4. **One `decide()` contract for player delegates and rival-team AI** (section 5.19): `decide<TContext, TDecision>(context, competence, intent, rng)`. There is no separate "AI logic" — rivals call the same function with their staff's parameters. Fixed in M1, before the first decision-making system.
5. **Balance constants live in `src/data/balance/*.json`**, each value commented — never hardcoded in logic.
6. **Content is data, not code.** Tracks, teams, drivers, car parts load from JSON packs validated by Zod, so players can substitute their own. The default pack is fictional (recognizable archetypes, not real names); no realistic/licensed pack goes in the repo.
7. **A design-note in `docs/systems/` precedes any large system.** Every milestone ends with Vitest tests, a short `docs/adr/NNN-*.md`, and a `docs/CHANGELOG.md` update.
8. **UI screens are built against mock data first** (`src/ui/mocks/`), then wired to state. All uncertain values render through the single `Estimate` display component (section 6.6) — including in demo copy: never write an interval like "21–23 s" as plain text.

## Architecture

Stack (section 3.1): React 19 + TS strict, Vite, Zustand + Immer, TanStack Router, Tailwind + CSS variables, Radix primitives, D3-scale/shape with hand-rolled SVG (no d3-selection), Recharts, Motion, Comlink + Web Worker, Dexie (IndexedDB saves), seedrandom or a custom PCG32, Zod, Vitest + Testing Library. No backend, no online play in v1; desktop-first (min 1280×800); ru + en via i18n from day one. Libraries are installed in the milestone that first needs them — as of M0 Zustand, Comlink, Dexie, Zod, D3, Recharts and Motion are not yet installed. TypeScript is pinned to 6.0 because typescript-eslint does not support 7.x yet.

Layering (section 3.2) — the dependency direction is one-way, `sim` ← `app` ← `ui`; import through the `@/` alias (`@/sim/...`):

- `src/sim/` — engine, race, season, car, people, finance, media, ai, rng, types. The whole game runs here, headless.
- `src/data/` — `packs/default/`, `balance/`, `schema/` (Zod).
- `src/app/` — Zustand slices, the Web Worker wrapper, save serialization + version migrations. This is the only bridge between sim and UI.
- `src/ui/` — `design/` tokens (`tokens.css`) and primitives (Button, Panel, Table, Tooltip, Dialog), `screens/`, `widgets/`, `shell/` (top bar, sidebar, section tabs), `mocks/`, and `routes/`.
- `src/i18n/` — `locales/{en,ru}.json`; `en.json` is the type reference for keys, and a test keeps `ru.json` in step (including every plural form Russian needs).
- `docs/adr/`, `docs/systems/`, `docs/calibration/`.

UI conventions:

- **Routing** is TanStack Router file-based: one thin file per screen in `src/ui/routes/<section>/<tab>.tsx` that renders a component from `src/ui/screens/`. The section/tab list lives once in `src/ui/navigation.ts`; adding a tab means adding it there, adding its route file, and adding its label to both dictionaries. `src/ui/routeTree.gen.ts` is generated by the Vite plugin (on `dev`/`build`/`test`) and committed.
- **Colours** exist only as tokens (`bg-panel`, `text-lo`, `border-line`, `bg-tyre-soft`, `bg-accent`…); Tailwind's default palette is switched off, so `bg-blue-500` produces nothing. A colour token must never share a name with a text size (`xs`, `sm`, `base`, `lg`, `xl`). The player's team colour is set with `applyAccent()`.
- **Numbers** (times, gaps, money) use `font-mono`; `Table` columns take `numeric: true`.
- `/dev/components` is the component showcase; extend it when adding a primitive.

Simulation runs in a Web Worker from M2 onward; the UI only draws.

**Two time scales** (section 3.4): between races, one tick = one day. During a race weekend, sessions run by lap with per-sector segments, played back at ×1/×2/×5/×15 with pause and intervention.

## Testing and balancing

- Unit tests per simulation formula.
- **Determinism tests**: seed + input → fixed result hash, so unintended logic changes fail loudly.
- **Batch runs are the primary balancing tool** — `npm run sim:batch -- --seasons 100` emitting CSV statistics (champion distribution, average gaps, SC frequency, strategy spread). Calibration targets are numeric and specified per milestone (e.g. M2: top-to-backmarker gap ≈2–3%, driver lap scatter ≈0.2–0.4 s, soft-tyre deg ≈0.08–0.15 s/lap, SC in ~40% of races). M2 must produce `docs/calibration/M2.md` before any race UI exists.
- Save snapshots for migration tests.
- Performance budget: full headless race < 200 ms; race rendering holds 60 FPS at ×15.

## Commands

```bash
npm run dev            # Vite dev server, http://localhost:5173
npm run build          # tsc -b (app + sim + node projects), then vite build
npm run typecheck      # tsc -b only
npm run lint           # ESLint, type-aware, includes the layering rules
npm run format         # Prettier --write (markdown is excluded on purpose)
npm run format:check
npm test               # all Vitest projects once
npm run test:watch
npm run sim:batch -- --seasons 100   # balancing batch runner; exits 1 until M2 adds the race core
```

Single test file / single test / one project:

```bash
npx vitest run src/sim/types/game-date.test.ts
npx vitest run -t "rejects dates that do not exist"
npx vitest run --project sim     # node env: src/sim/**/*.test.ts and tests/
npx vitest run --project ui      # jsdom env: src/{app,ui,i18n}/**/*.test.{ts,tsx}
```

A sim test goes next to its module as `*.test.ts`; UI tests use Testing Library and query by role and accessible name (UI tests always run in English — see `src/test/setup.ts`).
