# Changelog

Вехи из `f1-manager-plan.md`, раздел 7. Веха считается сделанной, только когда у каждого пункта DoD есть подтверждение.

## M0 · Каркас — 2026-09-10 — готово

Решения: [ADR 001](adr/001-m0-scaffold.md). Design-note: [app-shell](systems/app-shell.md).

### Что сделано

- Vite 8, React 19, TypeScript 6 (strict, `noUncheckedIndexedAccess`), ESLint 10 (линтинг с типами), Prettier, Vitest 5 с проектами `sim` (node) и `ui` (jsdom).
- Структура папок из раздела 3.2, алиас `@/` → `src/`.
- Защита слоёв `sim ← app ← ui`: хук Claude Code, правила ESLint с тестом и `tsconfig.sim.json` без DOM.
- `GameDate` — игровой календарь как число дней, без JS `Date` (`src/sim/types/game-date.ts`).
- Дизайн-токены (Tailwind v4 `@theme static`), тёмная тема, акцент команды с автоматическим контрастным текстом, шрифты Roboto Condensed + JetBrains Mono.
- Примитивы: Button, Panel, Table, Tooltip, Dialog.
- Оболочка из 6.2: верхняя панель на моковых данных, 8 разделов, 32 вкладки-заглушки, страница «не найдено».
- i18n ru + en: типизированные ключи, русские формы множественного числа, переключатель языка.
- Демо-страница `/dev/components`.
- Скрипты `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `format:check`, `test`, `test:watch`, `sim:batch` (последний до M2 честно завершается с ошибкой).

### DoD

| Пункт | Подтверждение |
|---|---|
| Приложение запускается | `npm run build` — сборка проходит. `npm run dev` — открыто в Chrome на 1280×800: оболочка отрисована, шрифты загружены с кириллицей, консоль чистая |
| По всем разделам можно ходить | `src/ui/navigation.test.tsx`: каждая из 32 вкладок во всех 8 разделах открывается в своём разделе с активной вкладкой; `/` и `/<раздел>` ведут на первую вкладку; клики по меню и вкладкам; маршруты и пункты меню совпадают один к одному |
| 3 примера компонентов на демо-странице | `/dev/components`: кнопки, таблица, подсказка и диалог, палитра, типографика. Тест `renders the component showcase`, тесты примитивов в `src/ui/design/primitives.test.tsx` |

Проверки: `npm run typecheck`, `npm run lint`, `npm run format:check` — без ошибок; `npm test` — 81 тест в 5 файлах, все проходят.
