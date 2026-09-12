/**
 * World invariants: the M1 meaning of "a valid world". Returns every broken invariant, one line
 * each; an empty list means the world holds together. Pure and cheap — also usable after loading
 * a save or after a long batch run.
 */
import type { Pack } from '@/data/schema/pack';
import { canDelegate, DELEGATION_AREAS } from '../decide/delegation';
import { WEEKEND_SESSIONS } from '../season/weekend';
import type { StaffRole, World } from '../types/world';

const ESTIMATE_KEYS = 'basis,confidence,high,low,observedAt,sources,value';

export function checkWorld(world: World, pack: Pack): string[] {
  const issues: string[] = [];
  const fail = (message: string) => issues.push(message);
  const teams = Object.values(world.teams);
  const drivers = Object.values(world.drivers);
  const staff = Object.values(world.staff);

  // Records are keyed by their own ids.
  const keyedById = (name: string, record: Readonly<Record<string, { id: string }>>) => {
    for (const [key, value] of Object.entries(record))
      if (key !== value.id) fail(`${name}: key "${key}" holds "${value.id}"`);
  };
  keyedById('teams', world.teams);
  keyedById('drivers', world.drivers);
  keyedById('staff', world.staff);

  // Career.
  const players = teams.filter((t) => t.controller === 'player');
  if (players.length !== 1) fail(`expected exactly one player team, found ${players.length}`);
  if (world.teams[world.career.playerTeamId]?.controller !== 'player')
    fail('career.playerTeamId is not the player team');
  if (world.pack.id !== pack.manifest.id || world.pack.version !== pack.manifest.version)
    fail('world was built from another pack');
  const expectedTeams = pack.teams.length + (world.career.mode === 'founder' ? 1 : 0);
  if (teams.length !== expectedTeams) fail(`expected ${expectedTeams} teams, found ${teams.length}`);

  // Line-ups and contracts agree in both directions.
  for (const team of teams) {
    const [a, b] = team.drivers.race;
    if (a === b) fail(`${team.id}: the same driver twice in the race line-up`);
    for (const id of team.drivers.race) {
      const c = world.drivers[id]?.contract;
      if (!c || c.teamId !== team.id || c.role !== 'race')
        fail(`${team.id}: race driver "${id}" has no race contract with the team`);
    }
    for (const id of team.drivers.reserves) {
      const c = world.drivers[id]?.contract;
      if (!c || c.teamId !== team.id || c.role !== 'reserve')
        fail(`${team.id}: reserve "${id}" has no reserve contract with the team`);
    }
    for (const id of team.staffIds) {
      if (world.staff[id]?.contract?.teamId !== team.id)
        fail(`${team.id}: staff "${id}" is not contracted to the team`);
    }
    const supplier = world.engineSuppliers[team.engine.supplierId];
    if (!supplier) fail(`${team.id}: unknown engine supplier "${team.engine.supplierId}"`);
    else if (team.engine.works !== (supplier.worksTeamId === team.id))
      fail(`${team.id}: works flag disagrees with the supplier`);
  }
  for (const driver of drivers) {
    const c = driver.contract;
    if (!c) continue;
    const team = world.teams[c.teamId];
    const listed =
      c.role === 'race' ? team?.drivers.race.includes(driver.id) : team?.drivers.reserves.includes(driver.id);
    if (!listed) fail(`driver "${driver.id}" is contracted to "${c.teamId}" but not in its line-up`);
  }
  for (const person of staff) {
    const c = person.contract;
    if (c && !world.teams[c.teamId]?.staffIds.includes(person.id))
      fail(`staff "${person.id}" is contracted to "${c.teamId}" but not listed`);
    if (person.role === 'race-engineer' && c) {
      const driver = person.assignedDriverId === null ? undefined : world.drivers[person.assignedDriverId];
      if (driver?.contract?.teamId !== c.teamId)
        fail(`race engineer "${person.id}" does not run a driver of their team`);
    }
  }

  // Hidden truth: one entry per driver and team, inside the pack's ranges.
  for (const driver of pack.drivers) {
    const h = world.hidden.drivers[driver.id];
    if (!h) {
      fail(`driver "${driver.id}" has no hidden values`);
      continue;
    }
    const r = driver.hiddenRanges;
    if (h.potential < Math.floor(r.potential[0]) || h.potential > Math.ceil(r.potential[1]))
      fail(`driver "${driver.id}": potential out of range`);
    if (h.growthRate < r.growthRate[0] - 0.005 || h.growthRate > r.growthRate[1] + 0.005)
      fail(`driver "${driver.id}": growthRate out of range`);
    if (
      h.injuryProneness < r.injuryProneness[0] - 0.005 ||
      h.injuryProneness > r.injuryProneness[1] + 0.005
    ) {
      fail(`driver "${driver.id}": injuryProneness out of range`);
    }
  }
  for (const team of teams) if (!world.hidden.teams[team.id]) fail(`team "${team.id}" has no hidden values`);

  // Knowledge: every team estimates every driver; an estimate holds only its own fields.
  for (const team of teams) {
    const known = world.knowledge[team.id];
    if (!known) {
      fail(`team "${team.id}" has no knowledge`);
      continue;
    }
    for (const driver of drivers) {
      const e = known.drivers[driver.id]?.potential;
      if (!e) {
        fail(`${team.id} has no estimate of "${driver.id}"`);
        continue;
      }
      if (Object.keys(e).sort().join(',') !== ESTIMATE_KEYS)
        fail(`${team.id}/${driver.id}: estimate has unexpected fields`);
      if (!(e.low <= e.value && e.value <= e.high))
        fail(`${team.id}/${driver.id}: estimate value outside its interval`);
      if (e.low < e.basis.min || e.high > e.basis.max)
        fail(`${team.id}/${driver.id}: estimate outside the quantity's bounds`);
    }
  }

  // The weekend in progress: it belongs to a round that has not been completed, the sessions
  // behind its stage have results, and the grids exist exactly when the sessions that set them do.
  const open = world.weekend;
  if (open) {
    const weekend = world.season.calendar.find((r) => r.round === open.round);
    if (!weekend) fail(`weekend: round ${open.round} is not on the calendar`);
    else {
      if (weekend.status !== 'upcoming') fail(`weekend: round ${open.round} is already completed`);
      const order = WEEKEND_SESSIONS[weekend.format];
      if (open.stage !== 'done' && !order.includes(open.stage))
        fail(`weekend: "${open.stage}" is not a session of a ${weekend.format} weekend`);
      const run = open.stage === 'done' ? order : order.slice(0, order.indexOf(open.stage));
      for (const session of run)
        if (!weekend.sessions.some((s) => s.session === session))
          fail(`weekend: "${session}" is behind the stage but has no result`);
      for (const session of weekend.sessions)
        if (!run.includes(session.session))
          fail(`weekend: "${session.session}" has a result but has not been run`);
      const drivers = teams.flatMap((t) => t.drivers.race);
      for (const [name, grid, after] of [
        ['grid', open.grid, 'qualifying'],
        ['sprintGrid', open.sprintGrid, 'sprint-qualifying'],
      ] as const) {
        const expected = order.includes(after) && run.includes(after);
        if (expected !== (grid !== null)) fail(`weekend: ${name} disagrees with "${after}"`);
        if (grid && (grid.length !== drivers.length || new Set(grid).size !== grid.length))
          fail(`weekend: ${name} is not every car exactly once`);
      }
    }
  }

  // Calendar: rounds in order, all after the career starts.
  let previous = world.date;
  for (const round of world.season.calendar) {
    if (round.raceDate <= previous) fail(`round ${round.round} is not after the previous event`);
    previous = round.raceDate;
  }

  // Delegation: an area without its staff role stays manual.
  const player = world.teams[world.career.playerTeamId];
  if (player) {
    const roles = new Set<StaffRole>(
      player.staffIds.map((id) => world.staff[id]?.role).filter((r) => r !== undefined),
    );
    for (const area of DELEGATION_AREAS) {
      if (!canDelegate(area, roles) && world.career.delegation[area] !== 'manual')
        fail(`delegation: "${area}" has nobody to delegate to`);
    }
  }

  return issues;
}
