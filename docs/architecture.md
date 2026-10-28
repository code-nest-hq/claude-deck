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

- `Transport` — everything that differs between local and remote execution: `spawn`, `isDirectory`, `listDir` (folder browser), `readFile` (attachments), `listSessions`, `history`, `sessionExists`, `usage`, `shell`, `git`, `waitSessionIdle`. Implementations: `local-transport.ts` and `ssh-transport.ts`.
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
- `bg.tasks { tasks }` — full list (replace semantics) of the session's background tasks (Bash `run_in_background`, backgrounded subagents, ...). Built in `runtime/bg-tasks.ts` from the SDK's `task_started`/`task_updated`/`task_notification`/`background_tasks_changed`; kept by the hub and sent in the `snapshot` (`bgTasks`). Running tasks become `stopped` when the process exits (they die with it). Output tail and stop go over HTTP (`GET|POST /api/projects/:id/sessions/:sid/bg/:taskId/{output,stop}`): the output file path (from the Bash placeholder result / `task_notification`) stays server-side and is read with `Transport.tailFile` (works over SSH); stop is `Query.stopTask`.
- **CLI-started turns**: when a background task ends the CLI injects a `<task-notification>` and runs a turn with no `send()`. The process stays open between turns, so its events flow normally; `SessionHub.emit` moves `idle` -> `running` on the first content event of such a turn.
- `mcp.status { id, servers?, error? }` / client message `{ type:'mcp', sessionId, id?, action? }` — the `/mcp` panel (see below).

## Model Routing

- **Goal**: per message, decide Haiku (cheap) vs Sonnet (capable), saving tokens without losing quality on complex tasks.
- **When it runs**: only if routing is on for the session (`session.routing ?? project.routing`, opt-in, default `false`). When off, `SessionHub.send` skips the whole block (`hub.ts:101`) — zero overhead, the fixed model comes from the hierarchy `session.model ?? project.model ?? config.defaults.model` (`domain.ts:13`).
- **Heuristic** (`server/src/runtime/routing.ts`): empty text -> `haiku`; > 400 chars -> `sonnet`; a short (< 80 chars) prompt about a commit message -> `haiku` (checked before `SONNET_HINTS`); matches `SONNET_HINTS` (implement/refactor/create/architect/fix bug/migrate/integrate/write code...) -> `sonnet`; matches `HAIKU_HINTS` (what is/explain/list/show/confirm/which...) and < 200 chars -> `haiku`; nothing matches -> **gray zone**, `null`.
- **Gray zone**: `SdkRuntime.classifyViaHaiku` (`sdk-runtime.ts:168`) opens a disposable Haiku session (`persistSession:false, maxTurns:1`, `CLASSIFY_SYSTEM_PROMPT` system prompt), asks for 1 word (`haiku`/`sonnet`), 15s timeout. Error/timeout/empty answer -> `sonnet` (never falls back to the cheap model on failure).
- **Learned routes**: every successful classifier verdict for a prompt ≤ 200 chars is stored in `<data dir>/routing-learned.json` (`{ normalizedPrompt: model }`, lowercase + collapsed whitespace, trailing `.!?` stripped, capped at 500 entries, oldest dropped). Order is heuristic -> learned -> classifier, so a repeated gray-zone prompt skips the classifier call. Failures are never learned; edit or delete an entry to correct a wrong verdict.
- **Sticky downgrade**: the prompt cache is per model, so a warm Sonnet -> Haiku switch rewrites the whole context (measured ~66k tokens, ~$0.12 per switch) and mostly cancels what Haiku saves. `SessionHub.send` skips routing entirely (no classifier call, no switch, logged as `routing.sticky`) when the session is on Sonnet, its context is above `STICKY_CTX_TOKENS` (30k, from the last `context.usage`) and the last turn ended less than `CACHE_TTL_MS` (5 min) ago. Upgrades from Haiku are never blocked. The classifier call runs with `tools: []` so it does not ship the built-in tool schemas.
- **Escalation**: with routing on, the SDK gets an internal MCP tool `request_model_upgrade(reason)` (`sdk-runtime.ts:74-84`) — the model itself (running on Haiku) can ask for an upgrade to Sonnet mid-turn; it goes through the normal permission flow (`canUseTool`) before `q.setModel('sonnet')` runs.
- **Haiku subagents**: with routing on, `Live` passes `agents: ROUTING_AGENTS` (`sdk-runtime.ts`) — a read-only `haiku-explorer` pinned to `haiku` — and the system-prompt `append` tells the main model to delegate multi-file exploration to it. The SDK can't switch model per tool call, so delegation is the only way to run reads on Haiku inside a Sonnet turn. Spec: `docs/superpowers/specs/2026-10-16-haiku-subagents-design.md`.
- **Visual turn states** (frontend, `reduce.ts`): `routing.started` -> `routing` phase; `model.routed` -> `thinking` phase (stores the model in `pendingRoutedModel`, shown on the user's next message); any real content event ends the phase (`idle`).
- **Opus architect (gated)**: with routing on, `ROUTING_AGENTS` also has a background, read-only `opus-architect` (`model: 'opus'`) for architectural analysis Sonnet can't do well, plus `sonnet-architect`. A `PreToolUse` hook on `Agent|Task` (`opusGate`, so it also applies under `bypassPermissions`) asks the user through the normal permission flow (card tool name `use_opus`); on deny it returns `updatedInput` rewriting `subagent_type` to `sonnet-architect`. Opus is subagent-only.
- **Fixed restriction**: routing never picks Opus/Fable for the session — blocked regardless of routing, see `forbiddenModel` below.

## Key decisions

- **Model allowlist**: `forbiddenModel = /opus|fable/i` (`sdk-runtime.ts:43`), checked in `SdkRuntime.open` (`MODELS`/`EFFORTS` allowlist) and on every main-session SDK message (`run()`; subagent messages with `parent_tool_use_id` are exempt so `opus-architect` works), defense in depth against a runtime model switch via command/config/env). Never remove this redundant check.
- **`bypass` (bypass permissions)**: a per-project flag (`project.bypass`) becomes `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` in the SDK (`domain.ts:18`, `sdk-runtime.ts:95`). A real feature, not a vulnerability — the user explicitly opted in per project.
- **Error log (Logs page)**: every error goes through `server/src/logs.ts` into `<data dir>/logs/YYYY-MM-DD.jsonl` (local date; the file is created by the day's first error, then appended). Sources: session `error` events (`SessionHub.emit`, with open options, state and the last 20 events), WebSocket request failures (`ws.ts`; busy/blocked as `warn`), HTTP 500s (`app.onError`), uncaught exceptions (`uncaughtExceptionMonitor`, sync write). Each entry has a UUID `id` carried as `errorId` on the error shown in the chat; entries are also broadcast live (`{ type: 'log' }`) and read back with `GET /api/logs?day=`. After a crash the recovery snapshot rebuilds the chat from the jsonl, so the hub re-sends the crash error (same `errorId`, not logged twice).
- **Session export**: `SessionHub.emit()` (plus `interrupt`/`reload`/`stopTask`/`mcp` actions, process open/exit, the routing verdict, and the `/compact` request) appends everything the Deck did to `<data dir>/session-logs/<sessionId>.jsonl` (`session-log.ts`; no `message.delta`). The Chat header's "Exportar" button calls `GET /api/projects/:id/sessions/:sid/export?redact=1|0`, which merges that log with the Claude Code transcript (`Transport.readTranscript`, local or SSH, subagents included) into one NDJSON file (`export.ts`): line 1 is a manifest (instructions for the reading AI, per-origin bytes/calls/estimated tokens for skills, MCP servers, hooks, subagents and tools, real token usage per model and per agent deduplicated by message id, cache hit ratio, compactions with who asked, routing verdicts and classifier cost), then the timeline ordered by time. Deck lines the transcript already holds (`user.message`, `message.completed`, `tool.*`) are dropped from the export only when the transcript is present, so after Claude Code's own cleanup (`cleanupPeriodDays`, default 30 days) the Deck copy is all that is left. Secrets are masked by default (`redact.ts`, best effort). Sessions created before the log existed export the transcript part only.
- **Auto-compact**: per-project flag (`project.autoCompact`), decided client-side (`AutoCompactModal.tsx`). After each turn whose `context.usage` is ≥ 60% of the autocompact window **or ≥ 150k tokens** (`COMPACT_TOKENS`; on a 1M window 60% = 600k, which sessions never reach) it asks to run `/compact`; cancel only skips that turn. On by default for new projects (`POST /api/projects` sets `autoCompact: true`; existing projects keep their setting). Second trigger, **cold cache**: with the flag on, sending a message after a pause > 5 min (`COLD_CACHE_MS`) on a context ≥ 50k tokens (`COLD_CACHE_TOKENS`) opens `ColdCacheModal` first (send anyway / compact first / handoff); the next message would re-read the whole context uncached (~12× the cached price). It needs a `context.usage` seen in this chat, so the first message after reopening a session from history is not covered. Signal is context occupancy, not $ spent: each turn re-reads the whole context, and quality degrades well before the CLI's own near-limit auto-compact. Progress % is an estimate (the SDK only reports start/end).
- **`/mcp` panel**: the client intercepts `/mcp` (it never reaches the model) and sends `{ type:'mcp' }`. `SessionHub.mcp()` reads `Query.mcpServerStatus()` from the live session, or from a short-lived process when none is open (`SdkRuntime.mcp`, same pattern as `commands()`, no token cost). It then emits `mcp.status`: first without `servers` (loading), then with the list. Actions (`reconnect`/`enable`/`disable`) go through `reconnectMcpServer`/`toggleMcpServer` and refresh the same card by `id`. The UI's own Model Routing server (`source: 'sdk'`) is hidden, and env/headers are never sent to the browser. MCP OAuth sign-in: `auth` actions call the SDK's runtime-only (untyped, see `McpAuthApi` in `sdk-runtime.ts`) `mcpAuthenticate`, which returns the sign-in URL (`McpServerView.authUrl`); `authCallback` submits the redirected URL (`mcpSubmitOAuthCallbackUrl`), `clearAuth` signs out. Pass `redirectUri` = the Deck's own `GET /mcp-oauth/callback` (no bearer token; the pending OAuth `state` kept in `SessionHub.mcpOAuth` is the credential), so the browser's redirect finishes the sign-in automatically; the pasted-URL field stays as a fallback. Needs a live session (the pending OAuth state lives in the Claude process), so a short-lived process rejects them. Not yet verified against a real OAuth server.
- **Plugins panel**: REST, per project (no session needed). `routes.ts` runs the terminal's `claude plugin …` through `Transport.shell` in the project's directory (local, or SSH with the connection's `claudePath`; local runs under the active profile's `CLAUDE_CONFIG_DIR`). `GET /projects/:id/plugins` = `plugin list --json` + `plugin marketplace list --json`; the installable catalog is read from each marketplace's `.claude-plugin/marketplace.json` via `Transport.readFile` because `list --available` is ~2 MB, over the shell output cap. `POST` takes a `pluginActionSchema` action (install/uninstall/enable/disable/update, marketplace add/remove/update; ids and sources validated and shell-quoted, `--` before every positional) and returns the CLI output plus the refreshed list. The UI then calls the session reload so the open process picks the change up (`update` still needs a new process). Logic in `server/src/plugins.ts`.
- **Attachments**: `send` carries file paths; `Live.send` reads each via `Transport.readFile` (so SSH works too). Images up to 5 MB become image content blocks, everything else a `[Arquivo anexado: path]` text reference. `interrupt()` cancels a send whose attachments are still being read.
- **Terminal (`!cmd`)**: shell mode is deliberately synchronous and PTY-less — it runs the typed command through `Transport.shell()` (local or via SSH) and publishes `shell.started`/`shell.result` as normal session events (included in replay). It's not an interactive terminal on purpose — an SDK exec of a command would bypass permission approval.
