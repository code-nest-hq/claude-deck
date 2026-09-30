# Architecture

## Overview

Code Nest is a web app (browser) that opens and talks to Claude Code sessions, local or remote (SSH), via `@anthropic-ai/claude-agent-sdk`. The Node backend (Hono + WebSocket) holds the state of each session and bridges the SDK with connected clients; the React frontend consumes events over WebSocket and renders chat, tabs, the read-only terminal, etc.

## Main components

- **`web`** — React SPA. Consumes `/api/*` (HTTP) and `/ws` (WebSocket). See `docs/frontend.md`.
- **`server`** — Hono serves the API + static files from `web/dist`; `attachWs` wires the WebSocket to the `SessionHub`. See `docs/backend.md`.
- **`shared`** (`@ccui/shared`) — TS types and the event protocol (`EventBody`, `ServerMsg`) used by both `web` and `server`; the single source of truth for message shapes.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — spawns the `claude` process, exposes `query()`/`Query` (send message, `setModel`, `interrupt`, permissions via `canUseTool`). The backend doesn't reimplement the Claude Code protocol, it just wraps the SDK.

## Runtime

Abstraction in `server/src/runtime/types.ts`:

- `Transport` — everything that differs between local and remote execution: `spawn`, `isDirectory`, `listDir` (folder browser), `readFile` (attachments), `listSessions`, `history`, `sessionExists`, `usage`, `costCheckpoints` (spend dashboard), `shell`, `git`, `waitSessionIdle`. Implementations: `local-transport.ts` and `ssh-transport.ts`.
- `OpenOptions` — `cwd, sessionId, model, effort, lean, routing, permissionMode`.
- `LiveSession` — an open session: `send` (text + attachment paths), `interrupt`, `answerPermission`, `setModel`, `mcp`, `close`, `events` (AsyncIterable of `EventBody`).
- `ClaudeRuntime` — the facade used by `SessionHub`: `open`, `listSessions`, `history`, `usage`, `shell`, `commands`, `mcp`, `classify`, `settle`. Single implementation `SdkRuntime` (`sdk-runtime.ts`), parameterized by `Transport` — local and SSH use the same `SdkRuntime` class, only the `Transport` changes.

High-level flow for a message:

```
SessionHub.send(sessionId, text)
    -> openSpecFor() already resolved in domain.ts (per-session spec)
    -> runtime.open(OpenOptions) on the 1st message  -> LiveSession
    -> (if spec.routing) runtime.classify() -> live.setModel()
    -> live.send(text)
    -> live.events (AsyncIterable<EventBody>) -> SessionHub.pump() -> emit()
    -> WebSocket -> ServerMsg { type:'event', event }
    -> React store.ts -> applyEvent() (shared reducer) -> UI
```

`SessionHub.send` (`server/src/hub.ts:86`) marks the state `running` before the `await` of opening the process, so it never opens two processes for the same session in parallel.

## Remote / SSH

Decisions confirmed in code (`server/src/runtime/ssh-transport.ts`, `server/src/ssh-util.ts`), preserve when changing this area:

- **Remote session survival**: when the SSH client drops mid-turn, the remote `claude` finishes the turn on its own; the backend detects the drop (`error/exit` event), and `SessionHub.recover()` (`hub.ts:141`) waits via `waitSessionIdle` (polling `pgrep -f`) and resends the full jsonl snapshot as soon as the remote process exits.
- **Absolute `claudePath`**: resolved via `claudeExpr()`/`DEFAULT_CLAUDE_PATH` (`ssh-util.ts`) because `~/.local/bin` isn't in the `PATH` of a non-interactive SSH session.
- **`cwd` -> directory name**: `encodeCwd(cwd)` replaces everything that isn't `[A-Za-z0-9]` with `-` (`ssh-util.ts:22`), used in `$HOME/.claude/projects/<encoded>` on the remote host.
- **No local env forwarding**: `spawn()` in `ssh-transport.ts:19-24` doesn't forward local environment variables; the remote uses its own login environment.
- **Careful `pgrep -f`**: the pattern used in `waitSessionIdle` (`ssh-transport.ts:86`) is `[${id[0]}]${id.slice(1)}` — the bracket keeps `pgrep`/the shell itself from matching its own grep.
- **Two writers on the same jsonl**: when reopening a session that already exists (`SdkRuntime.open`, `sdk-runtime.ts:224-226`), it waits on `waitSessionIdle` before opening a new process, so it doesn't corrupt history with two `claude` processes writing at once.

This is different from the **local backend lock** (`~/.code-nest/lock`, single PID, one backend per `DATA_DIR`, used by `restart.sh`) and from **`run.json`** (`server/src/runtime/child.ts`), which only tracks PIDs of child `claude`/`ssh` processes to warn about (not kill) orphans on the next start — neither one uses `pkill -f`.

## WebSocket protocol

Architecturally relevant events/concepts (full protocol in `shared/src/index.ts`, not listed exhaustively here):

- `routing.started` / `model.routed { model }` — the per-message Model Routing cycle (see section below).
- `permission.requested { reqId, toolName, input }` / client-to-server message `{ type:'permission', sessionId, reqId, allow, updatedInput? }` — a single mechanism used both for normal tool approval and for the `AskUserQuestion` modal's answers (`updatedInput` carries the user's answers, resolved inside the SDK's `canUseTool`).
- `turn.completed { totals, modelUsage, ... }` — closes the turn; `SessionHub` computes the per-model delta for this run (`diffModelUsage`, `hub.ts:26`) because the jsonl stores cumulative totals, not per-turn.
- `session.state` — `idle | running | awaiting_permission | exited`.
- `context.usage { percentage, totalTokens, maxTokens }` — after each `result`, `SdkRuntime` reads `Query.getContextUsage({ detail: 'summary' })` (no token cost). `compact { phase, preTokens?, postTokens?, message? }` — mapped from the SDK's `status: 'compacting'` / `compact_boundary` / `compact_result: 'failed'`.
- `mcp.status { id, servers?, error? }` / client message `{ type:'mcp', sessionId, id?, action? }` — the `/mcp` panel (see below).

## Model Routing

- **Goal**: per message, decide Haiku (cheap) vs Sonnet (capable), saving tokens without losing quality on complex tasks.
- **When it runs**: only if routing is on for the session (`session.routing ?? project.routing`, opt-in, default `false`). When off, `SessionHub.send` skips the whole block (`hub.ts:101`) — zero overhead, the fixed model comes from the hierarchy `session.model ?? project.model ?? config.defaults.model` (`domain.ts:13`).
- **Heuristic** (`server/src/runtime/routing.ts`): empty text -> `haiku`; > 400 chars -> `sonnet`; matches `SONNET_HINTS` (implement/refactor/create/architect/fix bug/migrate/integrate/write code...) -> `sonnet`; matches `HAIKU_HINTS` (what is/explain/list/show/confirm/which...) and < 200 chars -> `haiku`; nothing matches -> **gray zone**, `null`.
- **Gray zone**: `SdkRuntime.classifyViaHaiku` (`sdk-runtime.ts:168`) opens a disposable Haiku session (`persistSession:false, maxTurns:1`, `CLASSIFY_SYSTEM_PROMPT` system prompt), asks for 1 word (`haiku`/`sonnet`), 15s timeout. Error/timeout/ambiguous -> `sonnet` (never falls back to the cheap model on failure).
- **Escalation**: with routing on, the SDK gets an internal MCP tool `request_model_upgrade(reason)` (`sdk-runtime.ts:74-84`) — the model itself (running on Haiku) can ask for an upgrade to Sonnet mid-turn; it goes through the normal permission flow (`canUseTool`) before `q.setModel('sonnet')` runs.
- **Visual turn states** (frontend, `reduce.ts`): `routing.started` -> `routing` phase; `model.routed` -> `thinking` phase (stores the model in `pendingRoutedModel`, shown on the user's next message); any real content event ends the phase (`idle`).
- **Fixed restriction**: routing never picks Opus/Fable — those are blocked regardless of routing, see `forbiddenModel` below.

## Key decisions

- **Model allowlist**: `forbiddenModel = /opus|fable/i` (`sdk-runtime.ts:43`), checked in `SdkRuntime.open` (`MODELS`/`EFFORTS` allowlist) and on every SDK message (`run()`, defense in depth against a runtime model switch via command/config/env). Never remove this redundant check.
- **`bypass` (bypass permissions)**: a per-project flag (`project.bypass`) becomes `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` in the SDK (`domain.ts:18`, `sdk-runtime.ts:95`). A real feature, not a vulnerability — the user explicitly opted in per project.
- **Error log (Logs page)**: every error goes through `server/src/logs.ts` into `<data dir>/logs/YYYY-MM-DD.jsonl` (local date; the file is created by the day's first error, then appended). Sources: session `error` events (`SessionHub.emit`, with open options, state and the last 20 events), WebSocket request failures (`ws.ts`; busy/blocked as `warn`), HTTP 500s (`app.onError`), uncaught exceptions (`uncaughtExceptionMonitor`, sync write). Each entry has a UUID `id` carried as `errorId` on the error shown in the chat; entries are also broadcast live (`{ type: 'log' }`) and read back with `GET /api/logs?day=`. After a crash the recovery snapshot rebuilds the chat from the jsonl, so the hub re-sends the crash error (same `errorId`, not logged twice).
- **Auto-compact**: per-project flag (`project.autoCompact`), decided client-side (`AutoCompactModal.tsx`). After each turn whose `context.usage` is ≥ 60% of the autocompact window it asks to run `/compact`; cancel only skips that turn. Signal is context occupancy, not $ spent: each turn re-reads the whole context, and quality degrades well before the CLI's own near-limit auto-compact. Progress % is an estimate (the SDK only reports start/end).
- **`/mcp` panel**: the client intercepts `/mcp` (it never reaches the model) and sends `{ type:'mcp' }`. `SessionHub.mcp()` reads `Query.mcpServerStatus()` from the live session, or from a short-lived process when none is open (`SdkRuntime.mcp`, same pattern as `commands()`, no token cost). It then emits `mcp.status`: first without `servers` (loading), then with the list. Actions (`reconnect`/`enable`/`disable`) go through `reconnectMcpServer`/`toggleMcpServer` and refresh the same card by `id`. The UI's own Model Routing server (`source: 'sdk'`) is hidden, and env/headers are never sent to the browser. MCP OAuth sign-in isn't possible from here: the SDK exposes no auth request, so it's done once in the terminal and the stored token is reused.
- **Attachments**: `send` carries file paths; `Live.send` reads each via `Transport.readFile` (so SSH works too). Images up to 5 MB become image content blocks, everything else a `[Arquivo anexado: path]` text reference. `interrupt()` cancels a send whose attachments are still being read.
- **Spend dashboard**: `/api/usage/today` and `/api/projects/:id/usage` aggregate the `cost-state` checkpoints from each session's jsonl (`Transport.costCheckpoints` + `jsonl.ts`); "today" = the latest cumulative value minus the last checkpoint before local midnight. Cost is an API-price estimate.
- **Terminal (`!cmd`)**: shell mode is deliberately synchronous and PTY-less — it runs the typed command through `Transport.shell()` (local or via SSH) and publishes `shell.started`/`shell.result` as normal session events (included in replay). It's not an interactive terminal on purpose — an SDK exec of a command would bypass permission approval.
