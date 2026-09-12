/**
 * The career: the world and the pack it came from. The app opens on the career-start screen; until
 * one is started it holds a demo career — mode A at Kestrel — so every other screen has a world.
 */
import { create } from 'zustand';
import { loadActivePack } from '@/data/packs/active';
import type { Pack } from '@/data/schema/pack';
import type { World } from '@/sim/types/world';
import { type CareerSetup, createWorld } from '@/sim/world/create-world';

export const DEMO_TEAM_ID = 'kestrel';

/** A seed for a new career or race: short enough to read out, random enough never to repeat. */
export function randomSeed(): string {
  return crypto.randomUUID().slice(0, 8);
}

export type NewCareer =
  | { mode: 'takeover'; teamId: string; principalName: string; seed: string }
  | { mode: 'founder'; principalName: string; teamName: string; seed: string };

type CareerStore = {
  pack: Pack;
  world: World;
  /** True until the player has started a career of their own: the app opens on that screen. */
  demo: boolean;
  startDemoCareer: (seed?: string) => void;
  startCareer: (career: NewCareer) => void;
};

function demoWorld(pack: Pack, seed: string): World {
  return createWorld(seed, pack, { mode: 'takeover', teamId: DEMO_TEAM_ID, principalName: 'Team Principal' });
}

const pack = loadActivePack();

/**
 * A founder's twelfth team needs more than a name: an engine, two free agents and a livery. The
 * screen asks for the name and the rest comes from the pack, so mode B is one click away (5.11).
 */
function founderSetup(career: Extract<NewCareer, { mode: 'founder' }>): CareerSetup {
  const freeAgents = pack.drivers.filter((d) => !d.contract).map((d) => d.id);
  const [first, second] = freeAgents;
  if (first === undefined || second === undefined)
    throw new Error('The pack has no free agents to found a team with');
  const supplier =
    pack.engineSuppliers.find((e) => e.worksTeamId === null)?.id ?? pack.engineSuppliers[0]!.id;
  const name = career.teamName.trim() || 'New Team';
  return {
    mode: 'founder',
    principalName: career.principalName,
    team: {
      name,
      shortName: name.split(' ')[0] ?? name,
      colours: { primary: '#2E8B57', secondary: '#F5F5F5' },
      baseCountry: 'GB',
      baseCity: 'Oxbridge',
    },
    engineSupplierId: supplier,
    driverIds: [first, second],
  };
}

export const useCareer = create<CareerStore>()((set) => ({
  pack,
  world: demoWorld(pack, randomSeed()),
  demo: true,
  startDemoCareer: (seed = randomSeed()) => set({ world: demoWorld(pack, seed), demo: true }),
  startCareer: (career) =>
    set({
      demo: false,
      world: createWorld(
        career.seed,
        pack,
        career.mode === 'takeover'
          ? { mode: 'takeover', teamId: career.teamId, principalName: career.principalName }
          : founderSetup(career),
      ),
    }),
}));
