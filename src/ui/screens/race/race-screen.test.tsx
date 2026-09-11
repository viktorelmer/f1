import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCareer } from '@/app/store/career';
import { setRaceEngine, useRace } from '@/app/store/race';
import { raceApi } from '@/app/worker/race-api';
import { createInlineEngine } from '@/app/worker/engine';
import { i18n } from '@/i18n';
import { frameAt } from '@/sim/race/replay';
import type { RaceEvent, RaceEventKind } from '@/sim/race/types';
import { contrast, NEUTRAL_ACCENT, visibleTeamColour } from '@/ui/design/accent';
import { MOCK_RACE, MOCK_RACE_NEEDS, mockRace } from '@/ui/mocks/race';
import { describeEvent } from './describe-event';
import { DriverPanel } from './DriverPanel';
import { EventFeed } from './EventFeed';
import { GapChart } from './GapChart';
import { RaceScreen } from './RaceScreen';
import { buildRoster } from './roster';
import { TimingBoard } from './TimingBoard';
import { TrackMap } from './TrackMap';
import { boardRows, neutralisedBands, nextPlannedStop } from './view-model';

const t = i18n.t.bind(i18n);
const { world, replay, seed: mockSeed } = mockRace();
const roster = buildRoster(world);
const rowsAt = (timeS: number) =>
  boardRows(frameAt(replay, timeS).cars, 'en', t, (n) => t('race.board.lapsDown', { count: n }));
const bodyRows = () => screen.getAllByRole('row').slice(1);
const rowName = (row: HTMLElement) => within(row).getAllByRole('cell')[1]!.textContent;
const retiredCount = replay.result.classification.filter((c) => c.status === 'retired').length;

/** Every kind the simulation can emit; the Record makes a new kind a compile error here. */
const EVENT_KINDS: Record<RaceEventKind, true> = {
  start: true,
  overtake: true,
  launch: true,
  defence: true,
  pit: true,
  'safety-car': true,
  'safety-car-in': true,
  vsc: true,
  'vsc-end': true,
  'drs-enabled': true,
  mistake: true,
  spin: true,
  crash: true,
  contact: true,
  failure: true,
  puncture: true,
  retirement: true,
  'rain-start': true,
  'rain-stop': true,
  'strategy-call': true,
  'chequered-flag': true,
};

describe('mock race', () => {
  it('has what the screen has to show: retirements, a safety car, a VSC and both player cars', () => {
    const kinds = new Set(replay.result.events.map((e) => e.kind));
    for (const kind of MOCK_RACE_NEEDS) expect(kinds).toContain(kind);
    expect(retiredCount).toBeGreaterThanOrEqual(2);
    expect([...roster.values()].filter((r) => r.isPlayer)).toHaveLength(2);
  });
});

describe('TimingBoard', () => {
  it('shows one row per car, in the order of the frame', () => {
    const midRace = replay.durationS / 2;
    render(<TimingBoard rows={rowsAt(midRace)} roster={roster} />);
    const frame = frameAt(replay, midRace);
    expect(bodyRows()).toHaveLength(22);
    expect(bodyRows().map(rowName)).toEqual(frame.cars.map((c) => roster.get(c.driverId)?.short));
  });

  it('marks the player rows and puts the retired at the bottom at the flag', () => {
    render(<TimingBoard rows={rowsAt(replay.durationS)} roster={roster} />);
    const current = bodyRows().filter((r) => r.getAttribute('aria-current') === 'true');
    expect(current.map(rowName).sort()).toEqual(
      [...roster.values()]
        .filter((r) => r.isPlayer)
        .map((r) => r.short)
        .sort(),
    );
    for (const row of bodyRows().slice(-retiredCount))
      expect(within(row).getByText(t('race.board.out'))).toBeInTheDocument();
    expect(within(bodyRows()[0]!).getByText(t('race.board.finished'))).toBeInTheDocument();
  });
});

describe('describeEvent', () => {
  // Thirty races of the same round reach every kind of event, rain included.
  const events: RaceEvent[] = Array.from(
    { length: 30 },
    (_, i) => raceApi.run(world, MOCK_RACE.round, `mock-${i}`).result.events,
  ).flat();

  it('the sample covers every event kind', () => {
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set(Object.keys(EVENT_KINDS)));
  });

  it.each(['en', 'ru'])('reads every event as a finished sentence (%s)', (language) => {
    const fixed = i18n.getFixedT(language);
    for (const event of events) {
      const text = describeEvent(event, roster, fixed);
      if (!text || /race\.|\{\{|undefined|NaN|\[object/.test(text)) {
        expect.fail(`${event.kind} ${JSON.stringify(event.detail)} → "${text}"`);
      }
    }
  });
});

describe('EventFeed', () => {
  it('lists events newest first', () => {
    const events = replay.result.events.slice(0, 5);
    render(<EventFeed events={events} roster={roster} />);
    const items = within(screen.getByRole('log')).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent(describeEvent(events[4]!, roster, t));
    expect(items[4]).toHaveTextContent(describeEvent(events[0]!, roster, t));
  });
});

describe('TrackMap', () => {
  it('draws the running cars and marks where the retired stopped', () => {
    const frame = frameAt(replay, replay.durationS);
    render(<TrackMap geometry={replay.input.geometry} cars={frame.cars} roster={roster} />);
    expect(screen.getAllByTestId('map-car')).toHaveLength(22 - retiredCount);
    expect(screen.getAllByTestId('map-retired')).toHaveLength(retiredCount);
  });
});

describe('GapChart', () => {
  it('draws the player lines over the field', () => {
    render(
      <GapChart
        result={replay.result}
        roster={roster}
        lapsDone={replay.totalLaps}
        events={replay.result.events}
        width={640}
      />,
    );
    expect(screen.getAllByTestId('gap-line-player')).toHaveLength(2);
  });

  it('shades neutralised laps, an unfinished period up to the last lap', () => {
    const at = (kind: RaceEventKind, lap: number): RaceEvent => ({
      timeS: lap * 90,
      lap,
      sector: null,
      kind,
      driverId: null,
      otherId: null,
      detail: {},
    });
    expect(neutralisedBands([at('vsc', 3), at('vsc-end', 4), at('safety-car', 10)], 20)).toEqual([
      { from: 3, to: 4, kind: 'vsc' },
      { from: 10, to: 20, kind: 'sc' },
    ]);
  });
});

describe('DriverPanel', () => {
  it('shows both player drivers and the next planned stop', () => {
    const frame = frameAt(replay, 0);
    const mine = frame.cars.filter((c) => roster.get(c.driverId)?.isPlayer);
    render(<DriverPanel cars={mine} roster={roster} />);
    for (const car of mine) {
      const card = screen.getByRole('article', { name: roster.get(car.driverId)!.short });
      const firstStop = nextPlannedStop(car.plan, 0);
      if (firstStop !== null) expect(card).toHaveTextContent(t('race.panel.nextStop', { lap: firstStop }));
    }
    const plan = [
      { compound: 'soft', fromLap: 1, toLap: 15 },
      { compound: 'hard', fromLap: 16, toLap: 57 },
    ] as const;
    expect(nextPlannedStop(plan, 3)).toBe(15);
    expect(nextPlannedStop(plan, 15)).toBeNull();
  });

  it('follows the strategist as the plan changes during the race', () => {
    const [driverId, history] = Object.entries(replay.result.planHistory).find(([, h]) => h.length > 2)!;
    const revision = history[2]!;
    const car = frameAt(replay, revision.timeS + 0.001).cars.find((c) => c.driverId === driverId)!;
    expect(car.plan).toEqual(revision.stints);
    expect(frameAt(replay, 0).cars.find((c) => c.driverId === driverId)!.plan).toEqual(history[0]!.stints);
  });
});

describe('team accent', () => {
  it('takes the livery colour that shows on the dark interface', () => {
    expect(visibleTeamColour({ primary: '#041E42', secondary: '#00A3E0' })).toBe('#00A3E0');
    expect(visibleTeamColour({ primary: '#d7263d', secondary: '#101010' })).toBe('#d7263d');
    expect(visibleTeamColour({ primary: '#101820', secondary: '#1b2a3b' })).toBe(NEUTRAL_ACCENT);
    for (const entry of roster.values()) expect(contrast(entry.colour, '#0c0f14')).toBeGreaterThanOrEqual(3);
  });
});

describe('race screen (M3 DoD: the race can be watched to the flag, and everything reads on screen)', () => {
  beforeEach(() => {
    setRaceEngine(createInlineEngine());
    useCareer.setState({ world });
    useRace.setState({ phase: 'setup', replay: null, timeS: 0, paused: false, speed: 1 });
  });
  afterEach(() => useRace.setState({ phase: 'setup', replay: null, timeS: 0 }));

  it('starts a race, plays it to the flag, then shows the classification and every event', async () => {
    const user = userEvent.setup();
    render(<RaceScreen />);

    await user.selectOptions(screen.getByLabelText(t('race.setup.round')), String(MOCK_RACE.round));
    const seed = screen.getByLabelText(t('race.setup.seed'));
    await user.clear(seed);
    await user.type(seed, mockSeed);
    await user.click(screen.getByRole('button', { name: t('race.setup.start') }));

    expect(await screen.findAllByRole('row')).toHaveLength(23);
    // At the lights the feed holds only what happened at t = 0.
    const atLights = replay.result.events.filter((e) => e.timeS <= 0).length;
    expect(within(screen.getByRole('log')).getAllByRole('listitem')).toHaveLength(atLights);

    act(() => useRace.getState().seek(Number.MAX_SAFE_INTEGER));

    // The flag has fallen: the result tab takes over and lists the classification.
    const result = screen.getByRole('table', { name: t('race.results.title') });
    const classified = within(result).getAllByRole('row').slice(1);
    expect(classified).toHaveLength(22);
    replay.result.classification.forEach((car, i) => {
      expect(classified[i]).toHaveTextContent(roster.get(car.driverId)!.short);
    });

    // Every event of the race is in the feed.
    await user.click(screen.getByRole('tab', { name: t('race.tabs.events') }));
    const feed = within(screen.getByRole('log'));
    expect(feed.getAllByRole('listitem')).toHaveLength(replay.result.events.length);
    for (const event of replay.result.events) {
      expect(feed.getAllByText(describeEvent(event, roster, t)).length).toBeGreaterThan(0);
    }
  });

  it('shows the engine error and keeps the setup', async () => {
    setRaceEngine({ run: () => Promise.reject(new Error('boom')) });
    const user = userEvent.setup();
    render(<RaceScreen />);
    await user.click(screen.getByRole('button', { name: t('race.setup.start') }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
