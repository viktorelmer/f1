/**
 * Builds the default pack's track geometry (src/data/packs/default/geometry.json) from
 * the open bacinger/f1-circuits dataset (MIT, https://github.com/bacinger/f1-circuits):
 *
 *   npm run pack:geometry
 *
 * Source GeoJSON is downloaded into .cache/f1-circuits/ on first run. Each circuit is a closed
 * LineString that starts at the start/finish line; the script projects it to metres, fixes the
 * racing direction where the source runs backwards, finds the longest straights for DRS zones,
 * and fits the outline into a 1000×1000 SVG viewBox. Track names in the pack are fictional; the
 * layouts are real (plan section 2).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache/f1-circuits');
const PACK = join(ROOT, 'src/data/packs/default');
const SOURCE_URL = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits';

type SourceConfig = {
  file: string;
  /** The source line runs against the racing direction. */
  reverse?: boolean;
  /** Where sectors 2 and 3 begin; defaults to thirds of the lap. */
  sectors?: [number, number];
  pitLane?: { entry: number; exit: number };
  /** Hand-placed DRS zones where straight detection picks the wrong straight. */
  drsZones?: { from: number; to: number }[];
};

/**
 * Pack track → source circuit. Direction was checked against each circuit's known winding and
 * turn-1 direction; only Marina Bay's source line runs backwards (the real circuit runs
 * anticlockwise, turn 1 a left-hander).
 */
const SOURCES: Record<string, SourceConfig> = {
  'al-rimal': { file: 'bh-2002' },
  corniche: { file: 'sa-2021' },
  'lakeside-park': { file: 'au-1953' },
  isewan: { file: 'jp-1962' },
  huangpu: { file: 'cn-2004' },
  // The longest straight by geometry is the climb after turn 1; the real zone is the pit straight.
  'porto-rocca': { file: 'mc-1929', drsZones: [{ from: 0.95, to: 0 }] },
  valles: { file: 'es-1991' },
  'saint-laurent': { file: 'ca-1978' },
  murtal: { file: 'at-1969' },
  northfield: { file: 'gb-1948' },
  danube: { file: 'hu-1986' },
  'hautes-fagnes': { file: 'be-1925' },
  noordzee: { file: 'nl-1948' },
  'parco-reale': { file: 'it-1922' },
  caspian: { file: 'az-2016' },
  'marina-lights': { file: 'sg-2008', reverse: true },
  'lone-star': { file: 'us-2012' },
  tenochtitlan: { file: 'mx-1962' },
  represa: { file: 'br-1940' },
  'neon-boulevard': { file: 'us-2023' },
  'pearl-coast': { file: 'qa-2004' },
  'falcon-island': { file: 'ae-2009' },
};

const VIEW = 1000;
const PADDING = 40;
const EARTH_M_PER_DEG = 111_320;
/** Vertices bending tighter than this radius end a straight. */
const STRAIGHT_MIN_RADIUS_M = 450;
/** A DRS zone starts this far into its straight (corner exit) and ends this far before its end. */
const DRS_START_SHARE = 0.15;
const DRS_END_SHARE = 0.06;

type Point = [number, number];

async function loadSource(file: string): Promise<[number, number][]> {
  const path = join(CACHE, `${file}.geojson`);
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    const response = await fetch(`${SOURCE_URL}/${file}.geojson`);
    if (!response.ok) throw new Error(`Download of ${file} failed: HTTP ${response.status}`);
    writeFileSync(path, await response.text());
  }
  const json = JSON.parse(readFileSync(path, 'utf8')) as {
    features: { geometry: { type: string; coordinates: [number, number][] } }[];
  };
  const geometry = json.features[0]?.geometry;
  if (geometry?.type !== 'LineString') throw new Error(`${file}: expected a LineString`);
  return geometry.coordinates;
}

/** Equirectangular projection around the circuit's mean latitude, in metres, y pointing down. */
function project(coords: [number, number][]): Point[] {
  const lat0 = coords.reduce((sum, [, lat]) => sum + lat, 0) / coords.length;
  const k = Math.cos((lat0 * Math.PI) / 180) * EARTH_M_PER_DEG;
  const [lon0] = coords[0]!;
  return coords.map(([lon, lat]) => [(lon - lon0) * k, -(lat - lat0) * EARTH_M_PER_DEG]);
}

const dist = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function turnAngle(prev: Point, at: Point, next: Point): number {
  const h1 = Math.atan2(at[1] - prev[1], at[0] - prev[0]);
  const h2 = Math.atan2(next[1] - at[1], next[0] - at[0]);
  let d = h2 - h1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * DRS zones on the `count` longest straights. A straight is a run of segments whose inner
 * vertices bend gently (radius above STRAIGHT_MIN_RADIUS_M); runs may wrap across the line.
 */
function findDrsZones(points: Point[], cumulative: number[], total: number, count: number) {
  const n = points.length;
  const isCorner = points.map((p, i) => {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const span = (dist(prev, p) + dist(p, next)) / 2;
    return span > 0 && Math.abs(turnAngle(prev, p, next)) / span > 1 / STRAIGHT_MIN_RADIUS_M;
  });

  // Walk once round the lap starting just after a corner, so no run is split by the array end.
  const firstCorner = isCorner.indexOf(true);
  if (firstCorner < 0) throw new Error('circuit without corners');
  const runs: { start: number; length: number }[] = [];
  let runStart = cumulative[firstCorner]!;
  let runLength = 0;
  for (let step = 0; step < n; step++) {
    const i = (firstCorner + step) % n;
    const j = (i + 1) % n;
    runLength += dist(points[i]!, points[j]!);
    if (isCorner[j]) {
      runs.push({ start: runStart, length: runLength });
      runStart = cumulative[j]!;
      runLength = 0;
    }
  }

  const round = (x: number) => Math.round(((((x % total) + total) % total) / total) * 1000) / 1000;
  return runs
    .sort((a, b) => b.length - a.length)
    .slice(0, count)
    .map((run) => ({
      from: round(run.start + DRS_START_SHARE * run.length),
      to: round(run.start + (1 - DRS_END_SHARE) * run.length),
      length: run.length,
    }))
    .sort((a, b) => a.from - b.from);
}

function fitToView(points: Point[]): Point[] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = (VIEW - 2 * PADDING) / Math.max(maxX - minX, maxY - minY);
  const offsetX = (VIEW - (maxX - minX) * scale) / 2;
  const offsetY = (VIEW - (maxY - minY) * scale) / 2;
  const r = (v: number) => Math.round(v * 10) / 10;
  return points.map(([x, y]) => [r((x - minX) * scale + offsetX), r((y - minY) * scale + offsetY)]);
}

async function main() {
  const tracks = JSON.parse(readFileSync(join(PACK, 'tracks.json'), 'utf8')) as {
    id: string;
    drsZones: number;
    lengthKm: number;
  }[];
  const all: unknown[] = [];

  for (const track of tracks) {
    const config = SOURCES[track.id];
    if (!config) throw new Error(`No geometry source configured for track "${track.id}"`);

    let coords = await loadSource(config.file);
    const [first, last] = [coords[0]!, coords[coords.length - 1]!];
    if (first[0] === last[0] && first[1] === last[1]) coords = coords.slice(0, -1);
    // Reversing keeps the start/finish vertex first.
    if (config.reverse) coords = [coords[0]!, ...coords.slice(1).reverse()];

    const metres = project(coords);
    const cumulative = [0];
    for (let i = 1; i < metres.length; i++)
      cumulative.push(cumulative[i - 1]! + dist(metres[i - 1]!, metres[i]!));
    const total = cumulative[cumulative.length - 1]! + dist(metres[metres.length - 1]!, metres[0]!);

    const drs = findDrsZones(metres, cumulative, total, track.drsZones);
    const view = fitToView(metres);
    const path = `M${view.map(([x, y]) => `${x},${y}`).join('L')}Z`;

    const geometry = {
      trackId: track.id,
      viewBox: [0, 0, VIEW, VIEW],
      path,
      sectors: config.sectors ?? [0.333, 0.667],
      drsZones: config.drsZones ?? drs.map(({ from, to }) => ({ from, to })),
      pitLane: config.pitLane ?? { entry: 0.97, exit: 0.03 },
      source: `bacinger/f1-circuits ${config.file}.geojson (MIT)${config.reverse ? ', direction reversed' : ''}`,
    };
    all.push(geometry);

    const lengthError = Math.abs(total / 1000 - track.lengthKm) / track.lengthKm;
    console.log(
      `${track.id.padEnd(15)} ${String(view.length).padStart(3)} pts  ${(total / 1000).toFixed(3)} km` +
        `${lengthError > 0.05 ? ` (pack says ${track.lengthKm} km!)` : ''}  DRS ${drs
          .map((z) => `${z.from}→${z.to} (${Math.round(z.length)} m)`)
          .join(', ')}`,
    );
  }
  writeFileSync(join(PACK, 'geometry.json'), JSON.stringify(all, null, 2) + '\n');
}

await main();
