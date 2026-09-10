/**
 * The screen map from plan section 6.2 — the single list of sections and their tabs. The sidebar
 * and the tab strips are drawn from it; every entry must have a route file under
 * src/ui/routes/<section>/<tab>.tsx (checked by the type of `tabPath` and by navigation.test.tsx).
 */
export const NAVIGATION = {
  hq: ['overview'],
  car: ['specs', 'development', 'upgrades', 'philosophy', 'reliability'],
  weekend: ['schedule', 'setup', 'programmes', 'strategy', 'race'],
  people: ['drivers', 'staff', 'academy', 'market', 'contracts'],
  team: ['departments', 'infrastructure', 'morale'],
  money: ['budget', 'cost-cap', 'sponsors', 'forecast'],
  media: ['press', 'social', 'reputation', 'crises'],
  championship: ['standings', 'calendar', 'rivals', 'regulations', 'history'],
} as const;

export type SectionId = keyof typeof NAVIGATION;
export type TabId<S extends SectionId = SectionId> = (typeof NAVIGATION)[S][number];

export const SECTION_IDS = Object.keys(NAVIGATION) as SectionId[];

export function tabsOf<S extends SectionId>(section: S): readonly TabId<S>[] {
  return NAVIGATION[section];
}

export type TabPath = { [S in SectionId]: `/${S}/${TabId<S>}` }[SectionId];
export type SectionPath = `/${SectionId}`;

export function sectionPath(section: SectionId): SectionPath {
  return `/${section}`;
}

export function tabPath<S extends SectionId>(section: S, tab: TabId<S>): TabPath {
  return `/${section}/${tab}` as TabPath;
}

export function sectionLabelKey(section: SectionId) {
  return `nav.sections.${section}` as const;
}

type TabLabelKey = { [S in SectionId]: `nav.tabs.${S}.${TabId<S>}` }[SectionId];

export function tabLabelKey<S extends SectionId>(section: S, tab: TabId<S>): TabLabelKey {
  return `nav.tabs.${section}.${tab}` as TabLabelKey;
}
