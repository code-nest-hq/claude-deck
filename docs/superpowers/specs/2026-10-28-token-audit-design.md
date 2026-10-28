# Token-saving audit — design

## Intent

Claude Deck ships three features whose promise is "spend fewer tokens": **auto-compact**, **Model Routing** and **handoff** (new session with a summary). Nobody has checked whether they deliver. A session export sent to Claude AI suggested compacts might cost more than they save; routing and handoff may be a net loss or a tie. The audit answers, from real usage: *did each feature save money, break even, or cost more?*

## Goals

- Per-session report, written automatically when a session is archived, with measured numbers for the three features.
- A terminal script (`npm run audit`) that reads those reports, computes verdicts per feature over all not-yet-analyzed sessions, and prints/saves a consolidated result.
- Zero Claude tokens spent by the audit itself. All arithmetic is done by the script.
- Each feature's verdict states its **break-even** (e.g. "compact pays off above ~N context tokens", "a handoff pays off if the new session lasts ≥ N turns").

## Non-goals

- Measuring answer quality (a handoff that forgets things, a Haiku answer that needed a redo). Reported as **"not measured"**, explicitly.
- Running the same task twice with a feature on/off (A/B). Possible later; not now.
- A UI in the web app. Terminal only.
- Features that do not save tokens (anything outside compact, routing, handoff).
- Automatic changes to thresholds/rules. The script reports; the user decides.

## Anti-goals

- A verdict built on guessed numbers presented as measured. Every figure is labeled **measured** (from the logs) or **estimated** (counterfactual, uses the price table).
- Counting compacts by `started` events (heartbeat bug, fixed 2026-10-28, old logs still contain them).

## What already exists (do not rebuild)

Per-session append-only log `<DATA_DIR>/session-logs/<sessionId>.jsonl` (`server/src/session-log.ts`, `DATA_DIR` = `~/.code-nest`). Useful lines: `turn.completed` (cost, input/output, cacheCreation/cacheRead, per-model `modelUsage`), `context.usage` (`totalTokens`, `percentage`, `maxTokens`), `compact` (`started`/`done` with `preTokens`/`postTokens`/`failed`; `by` = `user`|`deck-auto`|`cli-auto`), `compact.requested`, `compact.declined`, `routing.classified` (`model`, `source` = heuristic|learned|haiku|fallback, `costUsd`, `durationMs`), `routing.sticky`, `model.routed`, `process.open`. Session metadata (`archived`, project) lives in `sessions.json`.

## What must be added

1. **Handoff traceability** (today nothing links old and new session, and the enrich cost is lost):
   - `GET .../handoff?enrich=1`: record `handoff.generated` `{ costUsd, enriched, ctxTokens }` in the origin session's log (every call, since every enrich call costs money).
   - `createSessionBody` gets optional `handoffFrom` (session id) and `trigger` (`zone-badge` | `auto-compact-modal` | `cold-cache`); `SessionMeta` stores `handoffFrom`. On creation, record `handoff.from` in the new session's log and `handoff.to` in the origin's. The web passes both from `HandoffModal`/its callers.
2. **Audit report on archive**: `PATCH /sessions/:id` with `archived: true` writes `<DATA_DIR>/audit/<PROJECT_NAME>/<SESSION_ID>/audit.json` (+ `audit.md`, human-readable). Folder lives in the Deck data dir, never in the audited project.
3. **Backfill**: `npm run audit` also builds the report for any session that has a log but no report (old sessions, never-archived ones).
4. **Script**: `npm run audit` (tsx, in the style of the existing scripts). No test framework; extend `server/test/unit.test.ts`.

## Report content (`audit.json`)

Facts only, per session: totals; list of compacts (`pre`, `post`, `by`, duration, cost of the compact turn, outcome); per-turn rows needed for counterfactuals (model, tokens by kind, cost, context size); routing decisions (model, source, classifier cost/duration); handoff links (from/to, trigger, enrich cost, first-turn `cacheCreation` of the new session, turns the new session lasted); `analyzedAt` + `analysisVersion` (the "already analyzed" flag; bumping the version re-analyzes everything).

## Verdict rules

- **Compact**: count `done` + `failed` only. Cost = compact turn + cache rebuild on the next turn. Saving (estimated) = per-turn cache-read difference between `preTokens` and `postTokens` × the turns that followed in that session. Output: net per compact, plus a break-even context size.
- **Routing**: measured = classifier cost + spend on the chosen model. Estimated counterfactual = the same turn's tokens at Sonnet prices. Flag `fallback` verdicts (time lost, no learning) and `haiku`-source classifications whose classifier cost is a large share of the saving.
- **Handoff**: cost = enrich + the new session's first-turn `cacheCreation`. Counterfactual (estimated) = origin context × cache-read price per turn. Output: break-even in turns vs. turns the new session actually had. Quality: "not measured".
- Each verdict: `saved` / `break-even` / `cost more` / `not enough data` (with the sample size).

## Constraints

- Strict TypeScript, no new dependencies, no test framework. Reuse `readSessionLog`, `DATA_DIR`, shared types; no Controller/Service layers.
- Opus never appears. All code, comments, docs in English.
- `audit/` folder must not be committed to any project repo; secrets: reports contain numbers and ids only (no message text, no tool output).

## Left to the builder / my calls (mark and review)

- **Price table** (my call): a small constant of per-million-token rates for Haiku and Sonnet (input, output, cache write, cache read) used only for counterfactuals. Built-in sanity check: recompute `costUsd` of real turns from tokens × table and report the drift; if it exceeds a few percent, say so in the output instead of hiding it. The user should verify the rates.
- **Stale reports** (my call): a session can be un-archived and used again. The report stores the log's size/mtime it was built from; the script rebuilds it when the log has grown, and re-analysis is flagged accordingly.
- **Folder name** (my call): `<PROJECT_NAME>` is a filesystem-safe slug of the project name at report time; the report also stores `projectId`, so renames do not break lookups.
- Exact JSON shape, `audit.md` layout, CLI flags (`--project`, `--since`, `--reanalyze`), consolidated output format (terminal summary + saved file).
- Whether the consolidated result is also saved to `audit/summary.json`.
- A Claude Code skill that reads the consolidated result and proposes threshold/rule changes is **optional and out of scope for v1**.
