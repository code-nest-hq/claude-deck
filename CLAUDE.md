# Code Nest

Web app to run Claude Code sessions in the browser instead of the terminal: chat, multiple tabs/sessions, local and remote projects via SSH, Model Routing (per-message Haiku/Sonnet).

**All code, comments, commits, and documentation in this project are written in English. Always.**

## Stack

- Frontend: React + Vite + Tailwind, workspace `web`
- Backend: Node.js + Hono + WebSocket, workspace `server`
- Shared types: workspace `shared` (`@ccui/shared`)
- Session orchestration: `@anthropic-ai/claude-agent-sdk`
- Strict TypeScript across all workspaces (npm workspaces, no monorepo tool)

## Structure

- `web/src/` — React UI (components in `features/*`, state in `store.ts`, WS client in `ws.ts`)
- `server/src/` — Hono API + WebSocket + Agent SDK runtime (`hub.ts`, `domain.ts`, `runtime/`)
- `shared/src/` — types and WebSocket event protocol shared between both sides
- `docs/` — operational documentation (this repo) + `docs/superpowers/{specs,plans}/` (historical feature specs/plans)

## Important Rules

- Preserve existing patterns; reuse existing abstractions (`Transport`, `ClaudeRuntime`, `OpenOptions`, `LiveSession`, `SessionHub`) instead of creating new layers.
- Don't duplicate logic; don't introduce Controller/Service/Repository — the project doesn't use those layers.
- Focused changes: no unrelated refactors, no swapping dependencies without need, don't touch `web/dist` (generated) or `node_modules`.
- **Never use Opus or Fable**, in any model/config/suggestion. Only `haiku`/`sonnet` (see `MODELS` in `shared/src/index.ts`, and the `forbiddenModel` check in `server/src/runtime/sdk-runtime.ts:43`).
- Preserve the already-confirmed remote runtime (SSH) decisions — see `docs/architecture.md` §Remote/SSH — don't replace with a generic implementation without checking the code first.
- No prior git history before 2026-09-22 was an explicit project decision. Tests exist since 2026-09-30 (`server/test/`, built-in `node:test`); extend them when changing the covered areas, don't add a test framework.
- Write everything — code, comments, commit messages, docs — in English, never Portuguese.

## Before changing code

1. Identify the actual files involved (grep the symbol/event name, don't guess the path).
2. Check `docs/architecture.md`, `docs/frontend.md`, or `docs/backend.md` depending on the area; for feature-specific history/decisions, search `docs/superpowers/specs/` or `.../plans/` by feature name.
3. Check the pattern already used in the neighboring file/module before writing something new.
4. Implement the smallest change that resolves the request.
5. Validate with the real commands (section below).

## Validation

- `npm run typecheck` — runs `tsc -p shared && tsc -p server && tsc -p web`
- `npm run build` — builds the frontend (`web`)
- `npm run dev:server` / `npm run dev:web` — local dev
- `./restart.sh` — kills the old backend via the lock PID (`~/.code-nest/lock`), builds, and starts it again
- `npm test` — unit suite (free, no Claude process); `npm run test:live` — real Claude Code via the SDK (Haiku, costs a few cents). See `docs/testing.md`.
- There is no lint script in `package.json` — don't invent `npm run lint`.
- **Before every commit + push**: run `npm run typecheck`, `npm test` and `npm run test:live`; commit and push only if all pass. On a failure, don't commit — report the failing output.

## Context Efficiency

- Don't scan the whole repo; start from the file/module the task names.
- Targeted searches (grep the symbol/event name) instead of reading everything.
- Read only the relevant part of large files; follow imports/usages only when the task needs it.
- Never read `node_modules`, `web/dist`, caches, or logs.
- Never load all of `docs/superpowers/` — open only the spec/plan whose name matches the task's feature.
- Don't load every `docs/*.md` for a task that only touches one area (frontend OR backend, not both out of habit).

## Documentation

- `docs/architecture.md` — overview, runtime (local/SSH), WebSocket protocol, Model Routing. Read before changing flow between frontend/backend or the runtime.
- `docs/frontend.md` — structure of `web/src`, state, component patterns. Read before touching the UI.
- `docs/backend.md` — structure of `server/src`, SessionHub, transports, SDK. Read before touching backend/runtime.
- `docs/testing.md` — test suites (unit + live) and what to check manually.
- `docs/superpowers/specs/` and `.../plans/` — detailed specs and plans per feature; consult only the relevant one when depth/history is needed, never as general reading.
