import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TESTS = ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/*.bench.ts'];

// Layering: sim <- app <- ui (plan section 3.2). The same rules are enforced for the agent by
// .claude/hooks/check-sim-purity.sh; these make them hold in any editor and in CI.
// Regexes rather than globs so relative specifiers (`../../ui/x`) are caught as well as `@/ui/x`.
const importsFromUi = { regex: '(^|/)ui(/|$)', message: 'app/ must not depend on ui/.' };
const simRestrictedImports = [
  'error',
  {
    patterns: [
      { regex: '^react(-dom)?(/|$)', message: 'src/sim/ is pure TypeScript: no React.' },
      { regex: '(^|/)app(/|$)', message: 'src/sim/ must not depend on app/.' },
      { ...importsFromUi, message: 'src/sim/ must not depend on ui/.' },
    ],
  },
];
const simWallClock = 'src/sim/ must not read wall-clock time: take the passed-in GameDate instead.';

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'src/ui/routeTree.gen.ts']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['src/{ui,app,i18n,test}/**/*.{ts,tsx}', 'src/main.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/ui/routes/**/*.tsx'],
    rules: {
      // Route files export `Route`, not a component; fast refresh is handled by the router plugin.
      'react-refresh/only-export-components': 'off',
      // TanStack Router interrupts a load by throwing redirect() / notFound().
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [{ from: 'package', package: '@tanstack/router-core', name: ['Redirect', 'NotFoundError'] }],
        },
      ],
    },
  },

  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [importsFromUi] }] },
  },

  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': simRestrictedImports,
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: simWallClock },
        { name: 'performance', message: simWallClock },
        { name: 'window', message: 'src/sim/ runs headless.' },
        { name: 'document', message: 'src/sim/ runs headless.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the injected, named Rng stream.' },
        { object: 'crypto', property: 'getRandomValues', message: 'Use the injected, named Rng stream.' },
        { object: 'crypto', property: 'randomUUID', message: 'Use the injected, named Rng stream.' },
      ],
    },
  },
  {
    // Tests and benchmarks may measure wall-clock time and cross-check against Date.
    files: TESTS.map((glob) => `src/sim/${glob}`),
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // The sim imports schemas, balance and packs from data/, so data/ must stay just as free of
    // React, app/ and ui/ — or the engine picks them up second-hand.
    files: ['src/data/**/*.ts'],
    rules: { 'no-restricted-imports': simRestrictedImports },
  },

  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },

  prettier,
]);
