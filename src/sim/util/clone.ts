/**
 * Deep copy of plain data (objects, arrays, primitives) — the only kind the sim holds. Kept here
 * rather than using structuredClone, which is a host API the headless engine must not rely on.
 */
export function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone) as T;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) out[key] = clone(v);
  return out as T;
}
