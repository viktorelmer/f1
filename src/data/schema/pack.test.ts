import { describe, expect, it } from 'vitest';
import { defaultPackFiles, loadDefaultPack } from '@/data/packs/default';
import { parsePack, STAFF_ROLES } from './pack';

type Files = typeof defaultPackFiles;
/** A deep copy of the default pack's files to break in one place. */
const files = (): Files => JSON.parse(JSON.stringify(defaultPackFiles)) as Files;

function issuesOf(mutate: (f: Files) => void): string[] {
  const f = files();
  mutate(f);
  const result = parsePack(f);
  return result.success ? [] : result.issues;
}

describe('default pack', () => {
  const pack = loadDefaultPack();

  it('is valid and has the size the plan asks for (M1)', () => {
    expect(pack.tracks).toHaveLength(22);
    expect(pack.geometry).toHaveLength(22);
    expect(pack.teams).toHaveLength(11);
    expect(pack.engineSuppliers).toHaveLength(4);
    const contracted = pack.drivers.filter((d) => d.contract);
    expect(contracted.filter((d) => d.contract?.role === 'race')).toHaveLength(22);
    // 40 reserves: each team's official reserve plus the free agents.
    expect(pack.drivers.filter((d) => d.contract?.role !== 'race')).toHaveLength(40);
  });

  it('staffs every team with one person per role and a race engineer per driver', () => {
    for (const team of pack.teams) {
      const staff = pack.staff.filter((s) => s.contract?.teamId === team.id);
      expect(new Set(staff.map((s) => s.role))).toEqual(new Set(STAFF_ROLES));
      expect(staff).toHaveLength(STAFF_ROLES.length + 1);
    }
  });

  it('turns calendar dates into GameDates in race order', () => {
    const rounds = pack.calendars[0]!.rounds;
    expect(rounds).toHaveLength(22);
    expect(rounds.filter((r) => r.sprint)).toHaveLength(6);
    expect(rounds.every((r, i) => i === 0 || r.raceDate > rounds[i - 1]!.raceDate)).toBe(true);
  });
});

describe('parsePack rejects broken data', () => {
  it('a missing field', () => {
    const issues = issuesOf((f) => {
      delete (f.tracks[0] as Partial<(typeof f.tracks)[number]>).laps;
    });
    expect(issues.some((i) => i.startsWith('tracks.0.laps'))).toBe(true);
  });

  it('an unknown extra field', () => {
    const issues = issuesOf((f) => Object.assign(f.teams[0]!, { budgetM: 300 }));
    expect(issues.join('\n')).toMatch(/teams\.0/);
  });

  it('an attribute out of range', () => {
    const issues = issuesOf((f) => {
      f.drivers[0]!.attributes.pace = 140;
    });
    expect(issues.some((i) => i.startsWith('drivers.0.attributes.pace'))).toBe(true);
  });

  it('a malformed date', () => {
    const issues = issuesOf((f) => {
      f.drivers[0]!.birthDate = '1999-02-30';
    });
    expect(issues.some((i) => i.startsWith('drivers.0.birthDate'))).toBe(true);
  });

  it('a dangling reference', () => {
    const issues = issuesOf((f) => {
      f.drivers[0]!.contract!.teamId = 'no-such-team';
    });
    expect(issues.join('\n')).toMatch(/unknown team "no-such-team"/);
  });

  it('a duplicate id', () => {
    const issues = issuesOf((f) => {
      f.tracks[1]!.id = f.tracks[0]!.id;
    });
    expect(issues.join('\n')).toMatch(/duplicate id/);
  });

  it('a person id shared by a driver and a staff member', () => {
    const issues = issuesOf((f) => {
      f.staff[0]!.id = f.drivers[0]!.id;
    });
    expect(issues.join('\n')).toMatch(/duplicate id/);
  });

  it('three race drivers in one team', () => {
    const issues = issuesOf((f) => {
      const reserve = f.drivers.find(
        (d) => d.contract?.role === 'reserve' && d.contract.teamId === 'marlowe',
      )!;
      reserve.contract!.role = 'race';
    });
    expect(issues.join('\n')).toMatch(/team "marlowe" has 3 race drivers/);
  });

  it('an empty hidden-value range', () => {
    const issues = issuesOf((f) => {
      f.drivers[0]!.hiddenRanges.potential = [95, 80];
    });
    expect(issues.some((i) => i.startsWith('drivers.0.hiddenRanges.potential'))).toBe(true);
  });

  it('a missing staff role', () => {
    const issues = issuesOf((f) => {
      f.staff = f.staff.filter((s) => !(s.contract?.teamId === 'kestrel' && s.role === 'meteorologist'));
    });
    expect(issues.join('\n')).toMatch(/team "kestrel" has 0 × meteorologist/);
  });

  it('a race engineer running another team’s driver', () => {
    const issues = issuesOf((f) => {
      const engineer = f.staff.find((s) => s.role === 'race-engineer' && s.contract?.teamId === 'spark')!;
      engineer.assignedDriverId = 'daan-vermeer';
    });
    expect(issues.join('\n')).toMatch(/must run a race driver of their own team/);
  });

  it('DRS zones that disagree with the track', () => {
    const issues = issuesOf((f) => {
      f.tracks[0]!.drsZones = 4;
    });
    expect(issues.join('\n')).toMatch(/declares 4 DRS zones/);
  });

  it('a calendar round on an unknown track or out of date order', () => {
    expect(issuesOf((f) => (f.calendars[0]!.rounds[3]!.trackId = 'atlantis')).join('\n')).toMatch(
      /unknown track "atlantis"/,
    );
    expect(issuesOf((f) => (f.calendars[0]!.rounds[3]!.raceDate = '2027-03-01')).join('\n')).toMatch(
      /not after the previous event/,
    );
  });

  it('a founder starting staff member who is already under contract', () => {
    const issues = issuesOf((f) => {
      f.newTeam.startingStaff[0]!.staffId = f.staff.find((s) => s.contract)!.id;
    });
    expect(issues.join('\n')).toMatch(/under contract, not a free agent/);
  });

  it('reports every issue, not only the first', () => {
    const issues = issuesOf((f) => {
      f.drivers[0]!.attributes.pace = 0;
      f.tracks[0]!.laps = 5;
    });
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});
