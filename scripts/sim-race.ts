/**
 * One race from the command line (plan M2): classification and the key events.
 *
 *   npm run sim:race -- --track al-rimal --seed demo
 *   npm run sim:race -- --round 7 --seed demo --events all
 *   npm run sim:race -- --track al-rimal --json race.json     full result as JSON
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadActivePack } from './pack';
import { buildRaceInput } from '@/sim/race/build-input';
import { simulateRace } from '@/sim/race/simulate';
import { createWorld } from '@/sim/world/create-world';

const { values } = parseArgs({
  options: {
    track: { type: 'string' },
    round: { type: 'string' },
    seed: { type: 'string', default: 'demo' },
    events: { type: 'string', default: 'key' },
    json: { type: 'string' },
  },
});

const pack = loadActivePack();
const world = createWorld(`${values.seed}-world`, pack, {
  mode: 'takeover',
  teamId: 'kestrel',
  principalName: 'CLI',
});
const calendar = world.season.calendar;
const driverName = (id: string | null) =>
  id === null ? '' : (pack.drivers.find((d) => d.id === id)?.name ?? id);
const teamName = (id: string) => pack.teams.find((t) => t.id === id)?.shortName ?? id;
const weekend =
  values.round !== undefined
    ? calendar.find((r) => r.round === Number(values.round))
    : calendar.find((r) => r.trackId === (values.track ?? 'al-rimal'));
if (!weekend) {
  console.error(`No such race. Tracks: ${calendar.map((r) => `${r.round}:${r.trackId}`).join(', ')}`);
  process.exit(2);
}

const input = buildRaceInput(world, pack, weekend.round, values.seed);
const t0 = performance.now();
const result = simulateRace(input);
const ms = performance.now() - t0;

const track = input.track;
const start = input.weather.samples[0]!;
console.log(
  `${track.name} — round ${weekend.round}, ${track.laps} laps, seed "${values.seed}" (${ms.toFixed(1)} ms), pack "${pack.manifest.name}"`,
);
console.log(
  `Start: air ${start.airTempC.toFixed(1)} °C, track ${start.trackTempC.toFixed(1)} °C, wind ${start.windKph.toFixed(0)} kph from ${start.windFromDeg.toFixed(0)}°\n`,
);

const time = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
};
for (const c of result.classification) {
  const gap =
    c.position === 1
      ? time(c.totalTimeS)
      : c.status === 'retired'
        ? `DNF (${c.retireReason})`
        : c.gapS !== null
          ? `+${c.gapS.toFixed(3)}`
          : `+${c.lapsDown} lap${c.lapsDown > 1 ? 's' : ''}`;
  console.log(
    `${String(c.position).padStart(2)}  ${driverName(c.driverId).padEnd(24)} ${teamName(c.teamId).padEnd(14)} ${gap.padEnd(28)} ${c.stops} stop${c.stops === 1 ? ' ' : 's'}  ${c.compounds.join('→').padEnd(24)} ${c.points ? `${c.points} pts` : ''}`,
  );
}

const key = new Set([
  'launch',
  'safety-car',
  'safety-car-in',
  'vsc',
  'vsc-end',
  'crash',
  'failure',
  'retirement',
  'puncture',
  'rain-start',
  'rain-stop',
  'contact',
  'spin',
]);
const shown = values.events === 'all' ? result.events : result.events.filter((e) => key.has(e.kind));
console.log(
  `\nEvents (${values.events === 'all' ? 'all' : 'key'}): ${result.events.filter((e) => e.kind === 'overtake').length} overtakes, ${result.events.filter((e) => e.kind === 'pit').length} pit stops`,
);
for (const e of shown) {
  const who = [e.driverId, e.otherId].filter(Boolean).map(driverName).join(' vs ');
  const detail = Object.entries(e.detail)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`  lap ${String(e.lap).padStart(2)}  ${e.kind.padEnd(14)} ${who} ${detail}`);
}

if (values.json) {
  writeFileSync(values.json, JSON.stringify({ input, result }, null, 2));
  console.log(`\nwrote ${values.json}`);
}
