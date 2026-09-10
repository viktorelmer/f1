import { type Pack, parsePack } from '@/data/schema/pack';
import calendars from './calendars.json';
import drivers from './drivers.json';
import engineSuppliers from './engine-suppliers.json';
import geometry from './geometry.json';
import manifest from './manifest.json';
import newTeam from './new-team.json';
import regulations from './regulations.json';
import staff from './staff.json';
import teams from './teams.json';
import tracks from './tracks.json';

/** The default pack's raw files, as a user pack would provide them. */
export const defaultPackFiles = {
  manifest,
  tracks,
  geometry,
  engineSuppliers,
  teams,
  drivers,
  staff,
  regulations,
  calendars,
  newTeam,
};

/** The default pack, validated. Throws with every issue listed if the bundled content is broken. */
export function loadDefaultPack(): Pack {
  const result = parsePack(defaultPackFiles);
  if (!result.success) throw new Error(`Default pack is invalid:\n${result.issues.join('\n')}`);
  return result.pack;
}
