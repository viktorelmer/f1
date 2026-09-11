import { describe, expect, it } from 'vitest';
import { loadActivePack } from '@/data/packs/active';
import { addDays, daysBetween } from '@/sim/types/game-date';
import { createWorld } from '@/sim/world/create-world';
import { topBarData } from './top-bar-data';

const pack = loadActivePack();
const world = createWorld('top-bar', pack, {
  mode: 'takeover',
  teamId: 'kestrel',
  principalName: 'Team Principal',
});

describe('topBarData', () => {
  it('shows the career: its date, the team cash and the pre-season test ahead', () => {
    const data = topBarData(world, pack);
    const test = world.season.preseasonTest;
    expect(data.date).toBe(world.date);
    expect(data.cashM).toBe(world.teams.kestrel!.finances.cashM);
    expect(data.nextEvent).toEqual({
      kind: 'test',
      round: 0,
      track: pack.tracks.find((t) => t.id === test.trackId)!.name,
      daysAway: daysBetween(world.date, test.startDate),
    });
    expect(data.constructorsPosition).toBeNull();
  });

  it('after the test, the next race; after the last race, nothing', () => {
    const afterTest = { ...world, date: addDays(world.season.preseasonTest.startDate, 5) };
    expect(topBarData(afterTest, pack).nextEvent).toMatchObject({ kind: 'race', round: 1 });
    const done = {
      ...afterTest,
      season: {
        ...world.season,
        calendar: world.season.calendar.map((r) => ({ ...r, status: 'completed' as const })),
      },
    };
    expect(topBarData(done, pack).nextEvent).toBeNull();
  });

  it('ranks the team in the constructors once anyone has scored', () => {
    const constructors = Object.fromEntries(Object.keys(world.teams).map((id, i) => [id, i]));
    const scored = {
      ...world,
      season: { ...world.season, standings: { ...world.season.standings, constructors } },
    };
    const better = Object.values(constructors).filter((p) => p > constructors.kestrel!).length;
    expect(topBarData(scored, pack).constructorsPosition).toBe(better + 1);
  });
});
