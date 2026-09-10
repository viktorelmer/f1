import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// Runs the real eslint.config.js over in-memory snippets, so the layering rules are themselves
// tested. The snippets are not files on disk, so type-aware linting is switched off; the layering
// rules are purely syntactic and do not need it.
const eslint = new ESLint({
  cwd: new URL('..', import.meta.url).pathname,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

const LAYER_RULES = new Set(['no-restricted-imports', 'no-restricted-globals', 'no-restricted-properties']);

async function layerViolations(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  const messages = result?.messages ?? [];
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(`ESLint could not parse the fixture: ${fatal.message}`);
  return messages.flatMap((m) => (m.ruleId && LAYER_RULES.has(m.ruleId) ? [m.ruleId] : []));
}

describe('layering rules (sim <- app <- ui)', () => {
  it.each([
    ["import { useState } from 'react';\nexport const s = useState;", 'no-restricted-imports'],
    ["import { createRoot } from 'react-dom/client';\nexport const c = createRoot;", 'no-restricted-imports'],
    ["import { Button } from '@/ui/design/Button';\nexport const b = Button;", 'no-restricted-imports'],
    ["import { x } from '../../app/store/x';\nexport const y = x;", 'no-restricted-imports'],
    ["import '@/app/worker/bridge';\nexport {};", 'no-restricted-imports'],
    ['export const now = Date.now();', 'no-restricted-globals'],
    ['export const d = new Date(0);', 'no-restricted-globals'],
    ['export const t = performance.now();', 'no-restricted-globals'],
    ['export const r = Math.random();', 'no-restricted-properties'],
    ['export const id = crypto.randomUUID();', 'no-restricted-properties'],
  ])('rejects in src/sim/: %s', async (code, rule) => {
    expect(await layerViolations(code, 'src/sim/race/fixture.ts')).toContain(rule);
  });

  it('accepts pure code in src/sim/', async () => {
    const code = "import { addDays } from '@/sim/types/game-date';\nexport const next = addDays;\n";
    expect(await layerViolations(code, 'src/sim/race/fixture.ts')).toEqual([]);
  });

  it('lets sim tests use the JS date API for cross-checks', async () => {
    const code = 'export const epoch = Date.UTC(1970, 0, 1);\n';
    expect(await layerViolations(code, 'src/sim/race/fixture.test.ts')).toEqual([]);
  });

  it('rejects ui/ imports from src/app/ but allows sim/', async () => {
    expect(
      await layerViolations(
        "import { Panel } from '@/ui/design/Panel';\nexport const p = Panel;",
        'src/app/store/fixture.ts',
      ),
    ).toContain('no-restricted-imports');
    expect(
      await layerViolations(
        "import { gameDate } from '@/sim/types/game-date';\nexport const g = gameDate;",
        'src/app/store/fixture.ts',
      ),
    ).toEqual([]);
  });

  it('keeps src/data/ as pure as the sim that imports it', async () => {
    for (const code of [
      "import { useState } from 'react';\nexport const s = useState;",
      "import { x } from '@/app/store/x';\nexport const y = x;",
      "import { Button } from '../../ui/design/Button';\nexport const b = Button;",
    ]) {
      expect(await layerViolations(code, 'src/data/schema/fixture.ts')).toContain('no-restricted-imports');
    }
    const ok =
      "import { z } from 'zod';\nimport { gameDate } from '@/sim/types/game-date';\nexport { z, gameDate };";
    expect(await layerViolations(ok, 'src/data/schema/fixture.ts')).toEqual([]);
  });
});
