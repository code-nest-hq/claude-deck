# Session export ("full overview") and removal of the Spend dashboard

Date: 2026-10-05 · Status: implemented (see "Implementation notes" at the end)

## Goal

Let the user export one file per session that another AI (Claude AI, ChatGPT, a skill) can read to analyze what was said and done, and to find where tokens are being wasted. The file covers both Claude Code's behavior (prompts, outputs, tools, skills, subagents, hooks, plugins such as Superpowers, Claude Mem and Task Observer) and Claude Deck's own behavior (what the app did in that session, e.g. when it asked for `/compact`).

The existing "Gastos" (Spend) button/dashboard is removed entirely.

## Decisions (agreed in brainstorming)

- **No database.** Persistence is an append-only JSONL file per session, the same mechanism as the daily error log (`server/src/logs.ts`). MongoDB would add a process and a dependency for a file that is read once, whole, by an AI.
- **Option 1 for recording:** only Deck-side events are recorded live. Claude Code's own transcript (`~/.claude/projects/.../<id>.jsonl`) is read and merged at export time. Known limit: Claude Code deletes transcripts after `cleanupPeriodDays` (default 30; `sdk.d.ts`), so after that a session exports with the Deck part only.
- **Content level: everything.** Full text of prompts, replies, tool inputs/outputs and hook output, plus aggregates. Not a truncated summary.
- **Secrets are masked by default**, with a checkbox to turn masking off at export time.
- **One `.jsonl` file**, no zip (no new dependency; chat UIs read a single file more easily).
- Sessions that already exist have no Deck-side log (it starts from now); they export the transcript part only.

## Part 1: remove the Spend dashboard

Remove:
- Web: `features/spend/*` (SpendDashboard and its project drill-down), the "Gastos" button in `features/projects/Sidebar.tsx`, `ui.spend` in `store.ts` (and every `setUi({ spend: ... })` call: Sidebar, `Chat.tsx`), the render branch in `app/App.tsx`, `api.usageToday`, the `TodayUsage` type.
- Server: `GET /api/usage/today`, `todayDelta`, `costCheckpoints` (function, `CostCheckpoint`, `Transport.costCheckpoints` in types/local/ssh).
- `GET /api/projects/:id/usage` (+ `ProjectUsageView`, `api` client method) is removed only if nothing but the drill-down uses it; verify with grep before deleting.
- Docs: `frontend.md`, `backend.md`, `architecture.md` (§Spend dashboard).

Keep: the Profile page "Uso" modal (plan rate limits), and the per-session `totals` shown in chat. They are unrelated to this feature.

## Part 2: Deck-side recording

New module `server/src/session-log.ts` (no new layer; same shape as `logs.ts`): `recordSession(sessionId, entry)` appends one JSON line to `<DATA_DIR>/session-logs/<sessionId>.jsonl` through a serialized promise chain, directory mode 0700, file mode 0600. Write failures are logged to stderr and never break the session.

Line shape: `{ ts: ISO string, kind: string, ...fields }`.

Sources:

1. **`SessionHub.emit()`** — single choke point. Records every event except `message.delta` (the transcript already has the text). Payload per event is the full event body (these bodies are already what the UI receives).
2. **Hub actions that don't go through `emit`:** `interrupt`, `reload`, `stopTask`, `shell`, `mcp` request; each records `kind: "action"` with its arguments.
3. **Process lifecycle:** process open (with the effective `OpenSpec`: model, effort, lean, routing, bypass, permission mode, resume or fresh, profile) and close/exit (with reason).
4. **Routing:** `ClaudeRuntime.classify()` currently returns only `Model`. It will return `{ model, source: 'heuristic' | 'learned' | 'haiku', costUsd?, durationMs }`, and the hub records it. This also makes the Haiku classifier spend visible; today it appears in no session transcript.
5. **Auto-compact:** the decision lives only in the web (`AutoCompactModal`). Two changes:
   - the WS `send` message gets an optional `origin: 'auto-compact'`; the hub records `kind: "compact.requested", by: "deck-auto"` (a manual `/compact` typed by the user records `by: "user"`);
   - a new short WS message `compact.declined` (user clicked cancel) is recorded as `kind: "compact.declined"` with the context percentage at the time.
   Both extend the Zod/WS protocol in `shared/src/index.ts`.

## Part 3: export

### Route and UI

- `GET /api/sessions/:id/export?projectId=<id>&redact=1|0` → `Content-Disposition: attachment; filename="<name>-<id8>-<date>.jsonl"`, `application/x-ndjson`. Default `redact=1`.
- Header button "Exportar" in `features/chat/Chat.tsx`, next to "Status". Opens a small modal (pattern of `StatusModal`) with a "Mask secrets" checkbox (default on), the transcript availability note, and a "Download" link.
- Open verification (do not assume): whether a plain link download passes the Deck's auth (`server/src/security.ts`). If it doesn't, fetch with the app's own request helper and save via a `Blob`.

### Reading the transcript

New `Transport` method (local and SSH implementations, following `jsonlTimestamps`/`parseHistory` read paths) that returns the raw jsonl text of a session, plus its subagent transcripts. Open verification:
1. Where subagent transcripts live on the remote host over SSH (locally: `<session dir>/subagents`, SDK `listSubagents`/`getSubagentMessages`).
2. The transcript path when the session uses a profile (`CLAUDE_CONFIG_DIR`).
3. Size limits of the existing `readFile` (it enforces one) versus what a full transcript needs (a 2 MB transcript exists today).

### Output file

**Line 1: `manifest`** (`type: "manifest"`):
- `readme`: plain-English instructions for the receiving AI: what each field means, how origins are classified, and what to look for (context bloat, repeated reads, cache misses, oversized tool outputs, plugin/hook injection cost, compaction timing).
- `session`: name, id, project, connection, model, effort, lean, routing, auto-compact, first/last timestamp, Deck/transcript availability.
- `byOrigin`: per origin (`skill:<name>`, `mcp:<server>`, `hook:<command>`, `subagent:<type>`, `tool:<name>`, `system:<kind>`): calls, bytes, **estimated** tokens (bytes/4, labeled as estimate), total duration.
- `tokens`: real per-model totals from each assistant message's `usage` (input, output, thinking, cache read, cache creation), cache hit ratio, per-turn series.
- `compactions`: each one with who requested it (user / deck-auto / CLI-auto), pre/post tokens.
- `routing`: counts by source and model, classifier cost.
- `redaction`: counts per secret type; `dropped`: counts of bookkeeping lines discarded.

**Lines 2..N: `timeline`**, ordered by timestamp:
- `src: "claude"`: the transcript item with full content, plus `origin` (same classification as above, plugin name when derivable from the skill/MCP/hook name, e.g. `superpowers:*`, `mcp__plugin_claude-mem_*`) and `bytes`. Subagent items carry `agent`.
- `src: "deck"`: the lines from Part 2.
- Discarded as content-free bookkeeping (counted in the manifest): `file-history-*`, `last-prompt`, `atis-latch`, `mode`, `permission-mode`.

Observed in real transcripts (2 sessions, ~3 MB): the largest context blocks were `prompt_snapshot` (237 KB), `skill_listing` (134 KB, 98 skills) and `hook_success` (105 KB). These are exactly the plugin/hook injection costs the report must surface per origin.

### Masking

`redactSecrets(value)` applied to every string at serialization, on by default. Patterns: provider keys (`sk-…`, `sk-ant-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `xox[bap]-…`), `Authorization`/`Bearer` values, PEM private-key blocks, `KEY=value` lines for names matching `(SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL)`. Replacement: `[REDACTED:<type>]`. It is a safety net, not a guarantee; the modal says so.

### Limits

- Whole-session export is built in memory; acceptable for the sizes observed (MBs). If a session exceeds a threshold, stream the response instead (decide in implementation, not now).
- Plugin attribution is by naming convention (skill prefix, `mcp__plugin_*` tool names, hook command path); unknown names fall under `tool:<name>` / `hook:<command>`.

## Testing

`node:test` in `server/test/` (existing suite; no new framework; `fakeRuntime` pattern):
- `session-log`: ordered appends, no `message.delta`, write failure doesn't throw.
- Hub: recording of emit, interrupt/reload/stopTask/shell, open/close spec, routing source, `compact.requested`/`compact.declined`.
- Exporter on a fixture transcript: origin classification (Skill, MCP, hook, subagent, native), per-origin aggregates, merge order Deck vs transcript, dropped-line counts.
- Masking: each pattern, plus a no-secret string unchanged.
- Spend removal: `npm run typecheck` and `npm run build` pass with no dangling references.
- `npm run test:live` stays green (Haiku, a few cents) before any commit.

## Docs to update

`docs/architecture.md` (session log + export, WS protocol additions), `docs/backend.md` (`session-log.ts`, exporter, `Transport` method), `docs/frontend.md` (Export modal; Spend removed), `docs/testing.md` (new test areas).

## Out of scope

Database, zip packaging, a Deck-side copy of the transcript (option 2 of the recording choice), retroactive Deck logs for sessions that already exist, an in-app viewer/analyzer for the export.

## Implementation notes (resolved verifications and deviations)

- **Download auth:** the HTTP API requires `Authorization: Bearer`, so a plain link cannot work; the web fetches with the token and saves a `Blob` (`api.exportSession`).
- **Transcript path with profiles:** `localTransport.readTranscript` tries the active profile's config dir, then `CLAUDE_CONFIG_DIR`, then `~/.claude`.
- **Subagents:** transcripts live in `<project dir>/<sessionId>/subagents/agent-<id>.jsonl` with an `agent-<id>.meta.json` (`agentType`, `description`, `toolUseId`). Over SSH one command prints the main file and every subagent file separated by a marker line (`parseRemoteTranscript`). `runSsh` caps stdout at 32 MB: a larger transcript is truncated silently over SSH.
- **Not recorded:** the profile in `process.open` (only the effective `OpenSpec` and `resumed`).
- **Dropped bookkeeping lines** also include `ai-title`, `agent-name`, `custom-title` (unknown line types are kept).
- **Hook attribution:** hooks are labeled `hook:<event>[:<command>]`; the command in a plugin hook is usually an unexpanded `${CLAUDE_PLUGIN_ROOT}/...`, so hooks are not attributed to a plugin. Skills (`plugin:name`) and MCP servers (`plugin_<name>_<server>`) are.
- **Aggregation detail:** a `hook_success` line carries the hook's stdout, which overlaps the `hook_additional_context` line; its bytes are shown on the line but not summed in `byOrigin`.
- **`classify()`** returns `{ model, source: 'heuristic' | 'learned' | 'haiku' | 'fallback', costUsd?, durationMs }`.
