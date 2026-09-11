# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project and workflow

A browser-based Formula 1 team-manager game. `f1-manager-plan.md` (Russian) is the spec and the source of truth: read the relevant section before implementing anything. Section 10 ("Зафиксированные решения") is fixed — it changes only through a new ADR.

Work goes strictly milestone by milestone (M0 → M12, plan section 7); the next milestone starts only when the current one meets its Definition of Done. The usual request is "implement milestone MN" — the `/milestone` skill (`.claude/skills/milestone/`) holds the procedure: design-note first and user sign-off, then types/data → sim → tests → UI, then verification against the DoD, an ADR and a CHANGELOG entry. **M0 (scaffold), M1 (domain and content), M2 (race core) and M3 (race screen) are done; M4 (race control and strategy) is next.** Each milestone is one commit on its own branch (`m0-scaffold`, `m1-domain`, `m2-race-core`, `m3-race-screen`, each branched from the previous one).

Documentation is in Russian: `docs/systems/` (design-note per system, written before its code), `docs/adr/NNN-*.md` (decisions and rejected alternatives per milestone), `docs/calibration/` (batch-run reports), `docs/CHANGELOG.md` (per milestone, with evidence for every DoD item). Code, comments and this file are in English.

## Commands

npm is the package manager (`package-lock.json`); do not create a `yarn.lock`.

```bash
npm run dev            # Vite dev server, http://localhost:5173
npm run build          # tsc -b (app + sim + node projects), then vite build
npm run typecheck      # tsc -b only
npm run lint           # ESLint, type-aware, includes the layering rules
npm run format         # Prettier --write (Markdown and the generated geometry.json are excluded)
npm run format:check
npm test               # all Vitest projects once
npm run test:watch

npm run sim:race -- --track porto-rocca --seed demo          # one race: classification + key events (--events all, --json out.json)
npm run sim:batch -- --track al-rimal --runs 1000 --seed M2  # one race many times → Markdown summary (--csv out.csv for per-race rows)
npm run sim:batch -- --all-tracks --runs 100 --seed M2       # whole calendar; season batches (--seasons) arrive in M5
npm run pack:geometry  # rebuild src/data/packs/default/geometry.json from bacinger/f1-circuits (sources cached in .cache/)
```

The sim is deterministic: the same `--seed` always gives the same race; pass another seed for another race.

**Which pack runs.** The app, the worker, the tests and the scripts all use the *active pack*: `src/data/packs/local/*.json` when that gitignored folder has files (any subset of the default pack's files; each replaces the default file whole, same ids), otherwise the fictional default. Code gets it from `loadActivePack()` — `@/data/packs/active` in Vite/Vitest, `scripts/pack.ts` in node scripts; never import `loadDefaultPack()` outside schema tests. Hashes pinned in tests are for the default pack and are skipped when a local pack is present (`isLocalPack`); determinism itself is still checked run-against-run. To test exactly what CI sees, move the local folder aside.

```bash
npx vitest run src/sim/race/tyres.test.ts         # one file
npx vitest run -t "rejects dates that do not exist"  # one test by name
npx vitest run --project sim   # node env: src/{sim,data}/**/*.test.ts and tests/
npx vitest run --project ui    # jsdom env: src/{app,ui,i18n}/**/*.test.{ts,tsx}
```

Scripts that import game code must run through `tsx --tsconfig tsconfig.node.json` — without it the `@/` alias does not resolve (the root `tsconfig.json` only holds project references).

## Architecture

### Layers

One-way dependencies, imported through the `@/` alias: `data` ← `sim` ← `app` ← `ui`.

- `src/data/` — content and constants, no logic beyond validation. `packs/default/*.json` + `loadDefaultPack()`; `balance/*.json` + the loader in `balance/index.ts`; `schema/` holds the Zod schemas (`pack.ts`, `balance.ts`, `race-balance.ts`) that pack and balance types are inferred from.
- `src/sim/` — the whole game, headless and pure. `types/world.ts` is the domain model; `rng/`, `knowledge/` (estimates), `decide/` (decision contract, delegation), `world/` (career start), `car/`, `race/`. The remaining folders from plan 3.2 (`engine`, `season`, `people`, `finance`, `media`, `ai`) are still empty placeholders.
- `src/app/` — the only bridge between sim and UI. `store/`: Zustand slices `career` (pack + world; until the career-start screen in M5 the app opens a demo career at Kestrel with a random seed) and `race` (Immer; phase, replay, playback clock, speed, pause). `worker/`: `raceApi` is the worker's surface, exposed with Comlink in `sim.worker.ts`; the store only knows the `RaceEngine` interface — the worker in the browser, `createInlineEngine()` in tests (jsdom has no workers). `save/` is still empty (M5+).
- `src/ui/` — React: `design/` (tokens + primitives), `shell/`, `screens/`, `routes/`, `mocks/`. The top bar and the race screen (`screens/race/`) read the store; every other screen is still a placeholder.
- `src/i18n/` — ru + en dictionaries; `tests/` — tests of tooling (the ESLint layering rules).

### The pipeline, end to end

1. **Pack** — JSON files → `parsePack()`: Zod shape checks plus cross-checks (unique ids across drivers *and* staff, references, two race drivers and a reserve per team, one person per staff role with a race engineer per driver, DRS zones matching geometry, calendar order). It returns every issue at once, as `path: message`.
2. **World** — `createWorld(seed, pack, career)` (`sim/world/create-world.ts`), for career mode A (`takeover` of one of 11 teams) or B (`founder` of a 12th team). Everything visible comes from the pack without the seed; the seed only draws `world.hidden` (true potential, growth, injury proneness, wind-tunnel correlation) and `world.knowledge` (each team's `Estimate`s of it). `checkWorld()` lists broken invariants. Static content (tracks, geometry, regulations) stays in the pack; the world keeps a reference to it.
3. **Race input** — `buildRaceInput(world, pack, round, seed)`: car performance derived from chassis parts + power unit (`car/performance.ts`), driver attributes, pit crew, the strategist's decision profile, the weather timeline (`generateWeather`), and a provisional grid (a one-lap shootout until qualifying lands in M5).
4. **Race** — `simulateRace(input): RaceResult` (ADR 003). A discrete-event simulation over sectors: cars are processed in the order they enter their next sector, and "the car ahead" is whoever last crossed that boundary — traffic, dirty air, DRS, overtaking, lapping, pit lanes and spun cars all follow from that one rule. Lap time follows the plan 5.4 formula, one small pure module per term (`pace`, `tyres`, `traffic`, `incidents`, `weather`, `track`). Positions and gaps are derived after the race from final line-crossing times, so later adjustments cannot desync the lap chart. Weather is part of the input, never rolled inside the race. Because processing order is sector *entry* time, not event time, race-wide state that changes mid-race must be read at the car's own time — the flag is a time-ordered list read with `flagAt(t)`; a plain "current" variable leaks the future to cars processed later (ADR 004, п. 8). Likewise the per-boundary `crossings` lists are in processing order and already hold cars *behind* that were simulated up to that boundary: find "the car ahead" by crossing time (`aheadAt`), never by list position (ADR 004, п. 10). Every change of places must come with an event (an overtake — one per car per sector — or a pit stop, spin, puncture, launch…); the test `explains every change of places between timing lines` guards it (ADR 004, п. 14).
5. **Playback** (ADR 004) — the race is computed whole in the worker, then played back: `buildReplay(input, result)` lays out every car's sector crossings, and `frameAt(replay, t)` (pure, `sim/race/replay.ts`) returns the frame at race time `t` — order, gaps, tyres, ERS, fuel, the strategist's current plan, track status, events so far. The frame at the flag equals the classification to the millisecond. Inside a sector a car moves along the lap's speed profile (`race/motion.ts`, from the geometry: corner radius, braking, acceleration), so it slows for corners; the timing-line crossings stay the race's own. M4's interventions are meant to re-simulate from the start with the same seed plus a timestamped command log, not to resume a paused engine.
6. **Measurement** — `race/analysis.ts` measures calibration metrics from the race output (not from model internals); `scripts/sim-batch.ts` aggregates them. `docs/calibration/M2.md` holds the targets and current numbers.

### Decisions and uncertainty

- **`decide()`** (`sim/decide/decide.ts`, plan 5.19): `(context, competence, intent, rng) => Decision<T>`, where `Decision` carries the choice *and* every option considered with its perceived score and reasons. Systems list options and score them as "share of the best achievable" (0..1, on a domain time scale), then call the shared `chooseByScore()`: noise shrinks with skill, blunders get rarer with consistency. Player delegates and AI rivals use the same function; rivals pass their staff's profile and their team character as intent — there is no separate AI path. First live uses: `race/strategy.ts` (`decideRaceStrategy`, `decidePitCall`).
- **`Estimate<T>`** (`sim/knowledge/estimate.ts`, plan 4.1): the only way uncertainty reaches the player. `measure(truth, precision, rng)` is the one place truth and bias are touched; `observe()` builds an estimate from one measurement, `refine()` fuses in more. `basis` holds the observer's unclamped mean/sd — never truth, never bias. Estimates are computed at defined moments and stored in state, never recomputed on render. The AI decides on its own team's estimates, never on the truth.

### UI conventions

- Routing is TanStack Router, file-based: one thin file per screen in `src/ui/routes/<section>/<tab>.tsx` rendering a component from `src/ui/screens/`. Sections and tabs are listed once in `src/ui/navigation.ts`; a new tab needs that entry, its route file and its label in both dictionaries. `src/ui/routeTree.gen.ts` is generated by the Vite plugin and committed.
- Colours exist only as tokens (`bg-panel`, `text-lo`, `border-line`, `bg-tyre-soft`, `bg-accent`…); Tailwind's default palette is switched off. A colour token must not share a name with a text size (`xs`, `sm`, `base`, `lg`, `xl`). The team colour is set with `applyAccent()`.
- Times, gaps and money use `font-mono`; `Table` columns take `numeric: true`. `/dev/components` showcases the primitives — extend it when adding one.
- UI tests run in English (`src/test/setup.ts`) and query by role and accessible name.
- A route that manages its own layout sets `staticData: { fullBleed: true }`; `SectionLayout` then drops its padding and outer scroll.
- The accent and team stripes use `visibleTeamColour(team.colours)`: the livery colour that reaches 3:1 on the dark ground, else the neutral accent. `AppShell` applies the player team's colour.
- The race screen re-renders 60+ times a second. Widgets are `memo`ised and fed through `useStable(value, signature)`, so only what changed redraws; keep new race widgets on that pattern. The race screen's mock is a fixed-seed run of the real sim (`ui/mocks/race.ts`, seed `mock-292`; re-pick it when race behaviour changes — the `mock race` test says what it must contain), not hand-written rows.

## Invariants

Each of these, broken, silently corrupts tests, replays or balancing.

1. **`src/sim/` is pure.** No React, no `Math.random`, no JS `Date` at all (the calendar is `GameDate`, an integer day count since 1970-01-01), no host APIs such as `structuredClone` (use `sim/util/clone.ts`). Enforced by `.claude/hooks/check-sim-purity.sh` on every edit, by ESLint (`src/data/` carries the same import bans because the sim imports it), and by `tsconfig.sim.json`, which type-checks the sim without DOM or Node types (test files are excluded from it: they may measure time).
2. **Determinism.** One seed per playthrough; each process draws from its own named stream, `streams(seed)('race:2027:r05:traffic')`, derived afresh and never saved. **Build stream names from ids and dates, never from array indices or iteration order** — that is why a new pack entry or a new subsystem never shifts anyone else's randomness. Every seeded process has a test pinned to a `fingerprint()` hash; a changed hash means changed behaviour for every seed — re-pin only when the change is intended, and record it in the milestone's ADR.
3. **Balance constants live in `src/data/balance/*.json`** as `{ "value": …, "why": "…" }`; the loader rejects a value whose `why` is missing or shorter than 12 characters. Logic reads `balance.<file>.<key>` and hardcodes no tunable number. A new constant needs **both** the JSON entry and its field in the Zod schema (`schema/balance.ts` or `schema/race-balance.ts`).
4. **Content is data.** Tracks, teams, drivers, staff, engines, regulations and calendars come from packs. A new pack field needs the schema in `schema/pack.ts`, the default pack JSON and, if it references anything, a cross-check. The default pack is fictional: no real names or brands, Latin script only, kebab-case ids; track geometry is real (bacinger/f1-circuits, MIT). **The owner's real-world pack lives in `src/data/packs/local/` (gitignored) and must never be committed** (plan section 10); nor may a `dist/` built on a machine that has it be published.
5. **Hidden truth lives only in `world.hidden`, seed-derived knowledge only in `world.knowledge`.** Everything else in a new world is identical for every seed — a test compares it byte for byte. The UI receives the world without `hidden`.
6. **Uncertain values render only through the shared `Estimate` component** (plan 6.6) — never as a plain-text interval, not even in demo copy.
7. **Race behaviour changes are re-calibrated.** After touching `src/sim/race/` or the race/tyre/weather balance, run `npm run sim:batch` (one track × 1000 and the whole calendar) and compare against `docs/calibration/M2.md` (and update it). The `calibration guard` test in `simulate.test.ts` only catches gross drift. Performance budget: a full headless race < 200 ms (currently 6–8 ms).
