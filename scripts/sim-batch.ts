/**
 * Batch runner — the primary balancing tool (plan section 8):
 *   npm run sim:batch -- --seasons 100
 * runs whole seasons headless and writes CSV statistics (champion distribution, average gaps,
 * SC frequency, strategy spread).
 *
 * The entry point exists from M0 so the workflow is wired up; the first batch-able system (the
 * race core) arrives in M2. Until then it fails loudly instead of printing an empty report that
 * could be mistaken for a real one.
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    seasons: { type: 'string', default: '100' },
    seed: { type: 'string' },
    out: { type: 'string' },
  },
});

const seasons = Number(values.seasons);
if (!Number.isInteger(seasons) || seasons < 1) {
  console.error(`--seasons must be a positive integer, got "${values.seasons}"`);
  process.exit(2);
}

console.error('sim:batch: no simulation systems to run yet — the race core arrives in milestone M2.');
process.exit(1);
