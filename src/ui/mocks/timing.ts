/** Mock timing rows for the component demo. Fictional drivers; real ones come from packs (M1). */
export type TyreCompound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';

export type TimingRow = {
  position: number;
  driver: string;
  team: string;
  teamColour: string;
  lastLap: string;
  gap: string;
  tyre: TyreCompound;
  tyreAge: number;
};

// prettier-ignore
export const timingMock: readonly TimingRow[] = [
  { position: 1, driver: 'R. Hart', team: 'Vantor', teamColour: '#e8e8e8', lastLap: '1:32.418', gap: '—', tyre: 'medium', tyreAge: 14 },
  { position: 2, driver: 'M. Okafor', team: 'Scuderia Rossa', teamColour: '#d7263d', lastLap: '1:32.702', gap: '+1.204', tyre: 'medium', tyreAge: 12 },
  { position: 3, driver: 'L. Brandt', team: 'Silberpfeil', teamColour: '#27c4b4', lastLap: '1:32.655', gap: '+3.881', tyre: 'hard', tyreAge: 3 },
  { position: 4, driver: 'K. Nakamura', team: 'Papaya', teamColour: '#ff8a1f', lastLap: '1:32.990', gap: '+7.019', tyre: 'soft', tyreAge: 18 },
  { position: 5, driver: 'E. Laurent', team: 'Bleu Alpin', teamColour: '#2f6fe0', lastLap: '1:33.104', gap: '+12.560', tyre: 'medium', tyreAge: 15 },
  { position: 6, driver: 'T. Silva', team: 'Emerald', teamColour: '#1f8a5b', lastLap: '1:33.271', gap: '+14.302', tyre: 'hard', tyreAge: 5 },
  { position: 7, driver: 'J. Kowalski', team: 'Kestrel', teamColour: '#9aa3ad', lastLap: '1:33.448', gap: '+19.955', tyre: 'medium', tyreAge: 16 },
  { position: 8, driver: 'A. Moreau', team: 'Navy Bulls', teamColour: '#1b2a6b', lastLap: '1:33.612', gap: '+24.117', tyre: 'soft', tyreAge: 20 },
];
