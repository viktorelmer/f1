/**
 * Batch runner — the primary balancing tool (plan section 8):
 *
 *   npm run sim:batch -- --track al-rimal --runs 1000        one race, many times
 *   npm run sim:batch -- --all-tracks --runs 100             every round of the calendar
 *   npm run sim:batch -- --track al-rimal --runs 1000 --csv out.csv
 *
 * Prints a Markdown summary (the numbers behind docs/calibration/M2.md); --csv writes one row per
 * race. Season batches (--seasons) arrive with the season loop in M5.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadDefaultPack } from '@/data/packs/default';
import { raceMetrics, type RaceMetrics } from '@/sim/race/analysis';
import { buildRaceInput } from '@/sim/race/build-input';
import { simulateRace } from '@/sim/race/simulate';
import type { RaceResult } from '@/sim/race/types';
import { createWorld } from '@/sim/world/create-world';

const { values } = parseArgs({
  options: {
    track: { type: 'string' },
    'all-tracks': { type: 'boolean', default: false },
    runs: { type: 'string', default: '100' },
    seed: { type: 'string', default: 'batch' },
    csv: { type: 'string' },
    seasons: { type: 'string' },
  },
});

if (values.seasons !== undefined) {
  console.error(
    'sim:batch: season batches need the season loop, which arrives in milestone M5. Use --track or --all-tracks.',
  );
  process.exit(1);
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) {
  console.error(`--runs must be a positive integer, got "${values.runs}"`);
  process.exit(2);
}

const pack = loadDefaultPack();
// The world only supplies teams, cars and people: the takeover team makes no difference to a race.
const world = createWorld(`${values.seed}-world`, pack, {
  mode: 'takeover',
  teamId: 'kestrel',
  principalName: 'Batch',
});
const calendar = world.season.calendar;
const rounds = values['all-tracks']
  ? calendar.map((r) => r.round)
  : calendar.filter((r) => r.trackId === (values.track ?? 'al-rimal')).map((r) => r.round);
if (rounds.length === 0) {
  console.error(`Unknown track "${values.track}". Tracks: ${calendar.map((r) => r.trackId).join(', ')}`);
  process.exit(2);
}

type Row = {
  round: number;
  track: string;
  run: number;
  ms: number;
  metrics: RaceMetrics;
  result: RaceResult;
};
const rows: Row[] = [];
for (const round of rounds) {
  const trackId = calendar.find((r) => r.round === round)!.trackId;
  for (let run = 0; run < runs; run++) {
    const input = buildRaceInput(world, pack, round, `${values.seed}-${round}-${run}`);
    const t0 = performance.now();
    const result = simulateRace(input);
    const ms = performance.now() - t0;
    rows.push({ round, track: trackId, run, ms, metrics: raceMetrics(input, result), result });
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────────────────────
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN;
};
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const dry = rows.filter((r) => !r.metrics.wet);

const out: string[] = [];
out.push(
  `# Batch: ${rounds.length} track(s) × ${runs} runs = ${rows.length} races (seed prefix "${values.seed}")`,
  '',
);
out.push('| Metric | Mean | p10 | p90 | Target |', '|---|---|---|---|---|');
const metric = (name: string, xs: number[], target: string, d = 2) =>
  out.push(`| ${name} | ${f(mean(xs), d)} | ${f(pct(xs, 0.1), d)} | ${f(pct(xs, 0.9), d)} | ${target} |`);
metric(
  'Team pace spread, % (dry)',
  dry.map((r) => r.metrics.paceSpreadPct),
  '2–3',
);
metric(
  'Driver lap scatter, s (dry)',
  dry.map((r) => r.metrics.lapScatterS).filter(Number.isFinite),
  '0.2–0.4',
  3,
);
metric(
  'Soft degradation, s/lap (dry)',
  dry.flatMap((r) => r.metrics.degradationS.soft ?? []),
  '0.08–0.15',
  3,
);
metric(
  'Medium degradation, s/lap (dry)',
  dry.flatMap((r) => r.metrics.degradationS.medium ?? []),
  '—',
  3,
);
metric(
  'Hard degradation, s/lap (dry)',
  dry.flatMap((r) => r.metrics.degradationS.hard ?? []),
  '—',
  3,
);
metric(
  'Overtakes per race',
  rows.map((r) => r.metrics.overtakes),
  'by track',
  1,
);
metric(
  'Pit stops per car',
  rows.map((r) => r.metrics.pitStops / r.result.classification.length),
  '1–2',
  2,
);
metric(
  'Retirements per race',
  rows.map((r) => r.metrics.retirements),
  '~1–3',
  2,
);
metric(
  'Winner’s margin, s',
  rows.flatMap((r) => r.metrics.winnerGapToP2S ?? []),
  '—',
  1,
);
metric(
  'Simulation time, ms',
  rows.map((r) => r.ms),
  '< 200',
  1,
);
const scShare = mean(rows.map((r) => (r.metrics.safetyCars > 0 ? 1 : 0))) * 100;
const vscShare = mean(rows.map((r) => (r.metrics.virtualSafetyCars > 0 ? 1 : 0))) * 100;
out.push(`| Races with a safety car, % | ${f(scShare, 1)} | | | ~40 |`);
out.push(`| Races with a VSC, % | ${f(vscShare, 1)} | | | — |`);
out.push(
  `| Wet races, % | ${f(mean(rows.map((r) => (r.metrics.wet ? 1 : 0))) * 100, 1)} | | | by track |`,
  '',
);
const causes = new Map<string, number>();
for (const r of rows)
  for (const e of r.result.events)
    if (e.kind === 'safety-car' || e.kind === 'vsc') {
      const key = `${e.kind === 'vsc' ? 'VSC' : 'SC'} ← ${e.detail.cause}`;
      causes.set(key, (causes.get(key) ?? 0) + 1);
    }
out.push(
  `Neutralisations per race by cause: ${[...causes]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${f(v / rows.length, 2)}`)
    .join(', ')}`,
  '',
);

if (rounds.length > 1) {
  out.push(
    '| Track | Overtakes (mean) | SC races % | SC profile | Wet % | Winner margin s |',
    '|---|---|---|---|---|---|',
  );
  for (const round of rounds) {
    const rs = rows.filter((r) => r.round === round);
    const track = pack.tracks.find((t) => t.id === rs[0]!.track)!;
    out.push(
      `| ${track.id} | ${f(mean(rs.map((r) => r.metrics.overtakes)), 1)} | ${f(mean(rs.map((r) => (r.metrics.safetyCars > 0 ? 100 : 0))), 0)} | ${track.profile.safetyCarProbability} | ${f(mean(rs.map((r) => (r.metrics.wet ? 100 : 0))), 0)} | ${f(mean(rs.flatMap((r) => r.metrics.winnerGapToP2S ?? [])), 1)} |`,
    );
  }
  out.push('');
} else {
  // One race many times: the distribution of results.
  const drivers = new Map<
    string,
    { team: string; wins: number; podiums: number; positions: number[]; dnf: number }
  >();
  for (const r of rows) {
    for (const c of r.result.classification) {
      const d = drivers.get(c.driverId) ?? { team: c.teamId, wins: 0, podiums: 0, positions: [], dnf: 0 };
      if (c.position === 1) d.wins++;
      if (c.position <= 3) d.podiums++;
      d.positions.push(c.position);
      if (c.status === 'retired') d.dnf++;
      drivers.set(c.driverId, d);
    }
  }
  out.push(
    '| Driver | Team | Wins % | Podiums % | Mean pos | Median pos | DNF % |',
    '|---|---|---|---|---|---|---|',
  );
  for (const [id, d] of [...drivers].sort((a, b) => mean(a[1].positions) - mean(b[1].positions))) {
    out.push(
      `| ${id} | ${d.team} | ${f((d.wins / rows.length) * 100, 1)} | ${f((d.podiums / rows.length) * 100, 1)} | ${f(mean(d.positions), 1)} | ${pct(d.positions, 0.5)} | ${f((d.dnf / rows.length) * 100, 1)} |`,
    );
  }
  out.push('');
  const teams = new Map<string, number[]>();
  for (const r of dry)
    for (const [t, p] of Object.entries(r.metrics.teamPaceS)) teams.set(t, [...(teams.get(t) ?? []), p]);
  const fastest = Math.min(...[...teams.values()].map(mean));
  out.push('| Team | Clean-lap pace (fuel-corrected), s | Behind fastest, % |', '|---|---|---|');
  for (const [t, xs] of [...teams].sort((a, b) => mean(a[1]) - mean(b[1]))) {
    out.push(`| ${t} | ${f(mean(xs), 3)} | ${f(((mean(xs) - fastest) / fastest) * 100, 2)} |`);
  }
  const strategies = new Map<string, number>();
  for (const r of rows)
    for (const c of r.result.classification)
      strategies.set(`${c.stops} stop(s)`, (strategies.get(`${c.stops} stop(s)`) ?? 0) + 1);
  out.push(
    '',
    `Stops per car: ${[...strategies]
      .sort()
      .map(([k, v]) => `${k} ${f((v / (rows.length * 22)) * 100, 1)}%`)
      .join(', ')}`,
    '',
  );
}
console.log(out.join('\n'));

if (values.csv) {
  const header =
    'round,track,run,ms,winner,winner_team,overtakes,safety_cars,vscs,retirements,pit_stops,wet,pace_spread_pct,lap_scatter_s,deg_soft,deg_medium,deg_hard,winner_margin_s';
  const lines = rows.map((r) =>
    [
      r.round,
      r.track,
      r.run,
      f(r.ms, 1),
      r.metrics.winner,
      r.metrics.winnerTeam,
      r.metrics.overtakes,
      r.metrics.safetyCars,
      r.metrics.virtualSafetyCars,
      r.metrics.retirements,
      r.metrics.pitStops,
      r.metrics.wet ? 1 : 0,
      f(r.metrics.paceSpreadPct, 3),
      f(r.metrics.lapScatterS, 3),
      f(r.metrics.degradationS.soft ?? NaN, 4),
      f(r.metrics.degradationS.medium ?? NaN, 4),
      f(r.metrics.degradationS.hard ?? NaN, 4),
      r.metrics.winnerGapToP2S ?? '',
    ].join(','),
  );
  writeFileSync(values.csv, [header, ...lines].join('\n') + '\n');
  console.error(`wrote ${lines.length} rows to ${values.csv}`);
}
