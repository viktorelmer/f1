/**
 * The career: the world and the pack it came from. Until the career-start screen (M5) the app opens
 * a demo career — mode A at Kestrel, with a fresh random seed.
 */
import { create } from 'zustand';
import { loadActivePack } from '@/data/packs/active';
import type { Pack } from '@/data/schema/pack';
import type { World } from '@/sim/types/world';
import { createWorld } from '@/sim/world/create-world';

export const DEMO_TEAM_ID = 'kestrel';

/** A seed for a new career or race: short enough to read out, random enough never to repeat. */
export function randomSeed(): string {
  return crypto.randomUUID().slice(0, 8);
}

type CareerStore = {
  pack: Pack;
  world: World;
  startDemoCareer: (seed?: string) => void;
};

function demoWorld(pack: Pack, seed: string): World {
  return createWorld(seed, pack, { mode: 'takeover', teamId: DEMO_TEAM_ID, principalName: 'Team Principal' });
}

const pack = loadActivePack();

export const useCareer = create<CareerStore>()((set) => ({
  pack,
  world: demoWorld(pack, randomSeed()),
  startDemoCareer: (seed = randomSeed()) => set({ world: demoWorld(pack, seed) }),
}));
