# AGENTS.md

Minimal key-decision log for AI coding agents working in this repo.

## Tooling

- **Package manager / task runner:** `vp` (Vite+). Use `vp <cmd>` — not `pnpm`,
  `npm`, or raw `vite`. Examples: `vp dev`, `vp build`, `vp check`,
  `vp add <pkg>`, `vp run <task>`.
- **Template:** `vite:application` (single React app).
- **Lint/format/types:** single command `vp check` (covers all three); the
  pre-commit hook runs `vp check --fix` on staged files.

## Stack

- React 19 + React Router 7 (data routers unnecessary so far; using
  `BrowserRouter` + `Routes`).
- TypeScript (`strict` is on via the template defaults; respect
  `verbatimModuleSyntax` and `erasableSyntaxOnly`).
- No global CSS framework. App shell styles live in `src/styles/`.

## Game engine integration (pending)

- Excalibur.js will live under the `/game` route. The placeholder page is
  `src/pages/Game.tsx`.
- Mount lifecycle: the engine must start on enter and tear down on leave (RAF
  loop + audio context). Use a `useEffect` cleanup; do not start it at module
  scope.
- The Canvas element belongs inside `Game.tsx`. Do not mount Excalibur in the
  document body.

## Conventions

- New top-level UI groups go under `src/pages/<name>/` with an `index.tsx`
  barrel; shared components under `src/components/`.
- Domain/game logic stays outside React. Put pure modules under `src/game/`
  and let components import them; this keeps the engine testable without a DOM.
