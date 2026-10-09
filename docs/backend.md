# Backend (`server/`)

Node.js + Hono + WebSocket. No Controller/Service/Repository — modules are files organized by responsibility under `server/src/`.

## File map

- `index.ts` — entry point: `openStore()`, `Connections`, `SessionHub`, Hono app (`/api` + static files from `web/dist`), `attachWs`, graceful shutdown on SIGINT/SIGTERM.
- `hub.ts` — `SessionHub`: coordinates per-session state, event buffer for replay, WebSocket<->runtime bridge. See `docs/architecture.md` for the full flow.
- `domain.ts` — `openSpecFor()` builds the `OpenSpec` (session->project->config hierarchy), `ensureMeta`, `touch`, `listProjectSessions`, `connectionIdFor`.
- `store.ts` — `JsonFile<T>` (atomic read/write with `.bak`), `openStore()` loads `config.json`/`projects.json`/`sessions.json`, `acquireLock()` — one backend per `DATA_DIR` via `~/.code-nest/lock` (PID).
- `connections.ts` — `Connections`: active runtimes (local + configured SSH connections), periodically monitors SSH status.
- `ws.ts` — `attachWs`: token-based auth handshake, dispatches client messages (`attach`, `detach`, `send`, `interrupt`, `shell`, `mcp`, `permission`, `compact.declined`); `send` is rejected with an explanation when `blockedSlash()` matches.
- `routes.ts` — REST API: `/api/state`, `/api/config`, `/api/connections` (+ `/test`, `/:id/browse` folder browser), `/api/projects` (+ `/:id/sessions`, `/:id/commands`, `/:id/git`, `/:id/sessions/:sid/status|export|reload|bg/...`), `/api/sessions/:id`, `/api/profiles` (+ `/:id/activate|login|login/code|logout`, `GET /:id/usage`, `DELETE /:id`).
- `session-log.ts` — per-session Deck-side log: `recordSession` appends one JSON line to `<data dir>/session-logs/<sessionId>.jsonl` (same serialized append chain as `logs.ts`; never throws), `readSessionLog`, `flushSessionLog`.
- `export.ts` — `buildExport()`: the session export (see `docs/architecture.md` §Session export). Pure function; `routes.ts` does the IO.
- `handoff.ts` — `buildHandoff()`: the "new session with handoff" prompt (goal, follow-up requests, files modified, commits, open todos, last assistant message) built from the transcript with no model call; `HANDOFF_SYSTEM_PROMPT` is the opt-in Haiku distillation (`ClaudeRuntime.handoffNotes`, `GET /api/projects/:id/sessions/:sid/handoff?enrich=1`).
- `redact.ts` — `redactString`/`redactDeep`: best-effort secret masking used by the export.
- `security.ts` — `guard` (token/host check), `makeToken`.
- `ssh-util.ts` — SSH helpers: `claudeExpr`, `encodeCwd`, `explainSshError`, `runSsh`, `shq` (shell-quote), `sshArgv`, `SESSION_ID_RE`.
- `commands.ts` — `blockedSlash` (rejects `/clear`, `/model`, `/fast`, `/advisor`, `/effort`, `/config` with a reason) and `visibleCommands` (drops blocked and terminal-only commands from the autocomplete list).
- `profiles.ts` — Claude account profiles for local sessions: each extra profile is a `CLAUDE_CONFIG_DIR` under `~/.code-nest/profiles/<id>` holding only its login (`.credentials.json`, `.claude.json`); every other entry is symlinked to `~/.claude`, so skills/plugins/settings/session history stay shared. `activeConfigDir()` is injected by `localTransport.spawn`, so switching applies to new sessions only. Login/logout run `claude auth login|logout` with the profile's env; profile views never include tokens. SSH projects keep using the remote host's login. Plan usage comes from `planUsage()` in `sdk-runtime.ts` (SDK `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`, a short-lived process spawned with the profile's env; undocumented extra fields are passed through).
- `git.ts` — parses `git status --porcelain=v2 --branch` into `GitInfo`.

### `runtime/`

- `types.ts` — the `Transport` (incl. `readTranscript`: a session's raw jsonl + its subagents' jsonl), `OpenOptions`, `LiveSession`, `ClaudeRuntime` (`classify` returns a `Classification`: model, source, classifier cost) interfaces (see `docs/architecture.md`).
- `sdk-runtime.ts` — `SdkRuntime` (the single `ClaudeRuntime` implementation) + the internal `Live` class (`LiveSession`). Uses `@anthropic-ai/claude-agent-sdk`: `query()`, `tool()`, `createSdkMcpServer()`, `canUseTool`. Contains `forbiddenModel`, the classifier (`classify`/`classifyViaHaiku`), the routing escalation MCP server, attachment reading (`attachmentBlocks`), and the `/mcp` status/actions (`mcpStatus`, used by both `Live.mcp` and the short-lived `SdkRuntime.mcp`).
- `local-transport.ts` — the local `Transport` (spawns `claude` directly), `reportOrphans()`.
- `ssh-transport.ts` — the SSH `Transport` (`sshTransport(conn)`), see decisions in `docs/architecture.md` §Remote/SSH.
- `child.ts` — `spawnManaged` (detached process, own process group, cascading kill), `run.json` (PID registry for orphan warnings, not a lock).
- `events.ts` — `mapMessage()`: translates SDK messages into the protocol's `EventBody`.
- `routing.ts` — `classifyHeuristic`, `CLASSIFY_SYSTEM_PROMPT` (see Model Routing in `docs/architecture.md`).
- `jsonl.ts` — parses the Claude Code jsonl: `parseHistory`, `firstPrompt`, `lastCostState`, `jsonlTimestamps`, `parseRemoteTranscript` (the SSH `readTranscript` output).

## SessionHub

`send(id, text)` (`hub.ts:86`): reserves the `running` state before the `await` of opening the session (avoids a duplicate process); if `spec.routing`, emits `routing.started` -> `runtime.classify()` -> `live.setModel()` -> emits `model.routed`; always emits `user.message` and calls `live.send(text)`.

`answerPermission(id, reqId, allow, updatedInput?)` — forwards to `live.answerPermission`, the same channel used both for normal tool approval and for `AskUserQuestion` answers.

`shell(id, command)` / `mcp(id, cardId?, action?)` — side channels that don't go to the model: each publishes its result as normal session events (`shell.*`, `mcp.status`, included in replay), with one run at a time per session (`shellRunning`/`mcpRunning`).

`recover(id, e)` (`hub.ts:141`) — called when the process dies (`error/exit`); waits on `runtime.settle()` (which uses `waitSessionIdle`) and resends the snapshot to every connected client.

## SSH

See `docs/architecture.md` §Remote/SSH — facts confirmed in code, don't reimplement generically without checking `ssh-transport.ts`/`ssh-util.ts` first.

## Model Routing

Split between `routing.ts` (heuristic + classification prompt) and `sdk-runtime.ts` (`classify`, `classifyViaHaiku`, the `request_model_upgrade` MCP tool). Toggle read in `domain.ts:16` (`project.routing ?? false`). Full detail in `docs/architecture.md` §Model Routing.

## Configuration

- Store lives at `~/.code-nest/{config,projects,sessions}.json` (or `CCUI_DATA_DIR`), atomic writes with `.bak` backup. A pre-rename `~/.claude-code-ui` is moved there once on start (`store.ts`).
- Config hierarchy: `SessionMeta.model/effort/routing` (per session) -> `Project.model/effort/routing/bypass/lean` (per project) -> `Config.defaults` (global, `model:'sonnet', effort:'medium'`).
- `permissionMode`: `default | plan | bypassPermissions`, derived from `project.bypass` in `domain.ts:18`.

## Error handling

- Permission timeout: 10 min (`PERMISSION_TIMEOUT_MS`, `sdk-runtime.ts:10`) -> auto-denies.
- Classification timeout: 15s (`CLASSIFY_TIMEOUT_MS`) -> assumes `sonnet`.
- A forbidden model detected in any SDK message -> emits `error` and closes the session (`sdk-runtime.ts:115-119`).
- SSH errors get a friendly message via `explainSshError()` (`ssh-util.ts`).
- Orphaned processes (`claude`/`ssh` left by a backend that didn't clean up) are only logged (`reportOrphans`), never auto-killed.

## Ports and boot

- Default port `4317` (`CCUI_PORT`), host fixed to loopback (`127.0.0.1`/`localhost`, refuses any other `CCUI_HOST`).
- `npm run start` runs `server/src/index.ts` directly with `tsx` (production, serves static `web/dist`); `npm run dev:server` uses `tsx watch` with fixed dev token/origin.
