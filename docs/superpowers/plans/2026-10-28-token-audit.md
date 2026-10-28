# Token-saving audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-session audit reports (written on archive) plus `npm run audit`, a terminal script that says whether auto-compact, Model Routing and handoff saved money, broke even or cost more.

**Architecture:** Three small server modules: `audit.ts` (pure: session log lines to a `SessionAudit` of facts + price table), `audit-verdict.ts` (pure: many `SessionAudit`s to verdicts + terminal text), `audit-store.ts` (IO: write/read `<DATA_DIR>/audit/...`, stale check). Handoff gets the missing log lines first. The script is a thin `server/scripts/audit.ts`. No Claude tokens are spent.

**Tech Stack:** TypeScript (strict), Node `fs`, `node:test` in `server/test/unit.test.ts`, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-token-audit-design.md`

## Global Constraints

- Strict TypeScript, no new dependencies, no test framework, no Controller/Service layers; reuse `readSessionLog`, `recordSession`, `DATA_DIR`, shared types.
- All code, comments, docs, commit messages in English. Opus appears nowhere.
- Reports hold numbers and ids only: no message text, no tool output.
- Compacts are counted by `done`/`failed`, never by `started` (old logs contain ~30s heartbeats of `started`; collapse consecutive `started` with no `done`/`failed` between them into one).
- Every figure is labeled `measured` or `estimated`. Handoff quality is reported as `not measured`.
- Verdict values: `saved` | `break-even` | `cost more` | `not enough data`.
- `audit/` lives in the Deck data dir, never in the audited project.
- Before every commit: `npm run typecheck`, `npm test`, `npm run test:live` must pass (project rule). Stage only the files the task names; `server/src/hub.ts` and others already carry uncommitted user changes, so `git add -p` hub.ts hunks you own.

## Review Focus

1. Old log with repeated `compact started` heartbeats: one compact, not several (Task 2 test).
2. Session with turns but no compact / no routing / no handoff, or an empty log: empty sections, no `NaN`, verdict `not enough data` (Tasks 2, 3).
3. Turn on a model that is neither Haiku nor Sonnet (e.g. synthetic/unknown id): counted in `unpricedTurns`, excluded from counterfactuals, never throws (Task 2).
4. Project name with `/`, `..` or only symbols: folder name is a safe slug, cannot escape `audit/` (Task 4).
5. Zero saving (`preTokens == postTokens`, new context >= old): break-even is `null`, not `Infinity`/`NaN` (Task 3).
6. Failed compact (session limit): counted as `failed`, cost 0, excluded from savings (Task 2).
7. Archive hook failure (disk error) must not fail the `PATCH` (Task 4).

---

### Task 1: Handoff traceability

**Files:**
- Modify: `shared/src/index.ts` (`SessionMeta`, `createSessionBody`; export `HandoffTrigger`)
- Modify: `server/src/handoff.ts`, `server/src/routes.ts` (handoff GET, session POST), `server/src/hub.ts`
- Modify: `web/src/api.ts` (`newSession`), `web/src/features/chat/HandoffModal.tsx`, `web/src/features/chat/Chat.tsx`
- Test: `server/test/unit.test.ts`

**Interfaces:**
- Produces (`shared`): `type HandoffTrigger = 'zone-badge' | 'auto-compact-modal' | 'cold-cache'`; `SessionMeta.handoffFrom?: string`; `createSessionBody` gains optional `handoffFrom: uuidSchema` and `trigger: z.enum([...])`.
- Produces (`server/src/handoff.ts`): `recordHandoffGenerated(sessionId: string, r: { costUsd?: number; enriched?: boolean; ctxTokens?: number }): void` records kind `handoff.generated`; `recordHandoffLink(fromId: string, toId: string, trigger: HandoffTrigger | undefined): void` records `handoff.to` `{ sessionId: toId, trigger }` in the origin log and `handoff.from` `{ sessionId: fromId, trigger }` in the new log.
- Produces (`SessionHub`): `contextTokens(id: string): number | undefined` (the entry's `ctxTokens`).

- [ ] **Step 1: Write the failing test** `handoff links are recorded in both session logs`: call `recordHandoffGenerated(a, { costUsd: 0.004, enriched: true, ctxTokens: 120000 })` and `recordHandoffLink(a, b, 'cold-cache')`; after `flushSessionLog()`, assert `readSessionLog(a)` contains `handoff.generated` with `costUsd 0.004` and `handoff.to` with `sessionId === b, trigger === 'cold-cache'`, and `readSessionLog(b)` contains `handoff.from` with `sessionId === a`.
- [ ] **Step 2: Run** `npm test` and confirm the new test fails (functions undefined).
- [ ] **Step 3: Implement** the two functions in `handoff.ts` using `recordSession`; add `contextTokens` to `SessionHub`.
- [ ] **Step 4: Wire the server.** In the handoff GET (`routes.ts`), after the `enrich=1` Haiku call (success or failure), call `recordHandoffGenerated(meta.sessionId, { costUsd: n.costUsd, enriched, ctxTokens: hub.contextTokens(meta.sessionId) })`. In the session POST, accept `handoffFrom`/`trigger`: set `meta.handoffFrom` and call `recordHandoffLink(b.handoffFrom, meta.sessionId, b.trigger)` only when `handoffFrom` belongs to the same project (else ignore it).
- [ ] **Step 5: Wire the web.** `api.newSession` body type gains `handoffFrom?: string; trigger?: HandoffTrigger`. `HandoffModal` takes a `trigger: HandoffTrigger` prop and passes `handoffFrom: sessionId, trigger` in `create()`. In `Chat.tsx` replace the `handoffOpen` boolean with `handoffTrigger: HandoffTrigger | null`: `ZoneBadge` sets `'zone-badge'`, `AutoCompactModal` sets `'auto-compact-modal'`, the cold-cache modal sets `'cold-cache'`.
- [ ] **Step 6: Verify** `npm run typecheck && npm test` pass.
- [ ] **Step 7: Commit** `feat(handoff): record handoff links and enrich cost in session logs` (after the full gate incl. `npm run test:live`).

---

### Task 2: Per-session facts (`audit.ts`)

**Files:**
- Create: `server/src/audit.ts`
- Test: `server/test/unit.test.ts`

**Interfaces:**
- Consumes: `SessionLogLine` from `./session-log`, `ModelUsage` from `@ccui/shared`.
- Produces:
  - `ANALYSIS_VERSION = 1`
  - `interface Rates { input: number; output: number; cacheWrite: number; cacheRead: number }` (USD per million tokens)
  - `RATES: { haiku: Rates; sonnet: Rates }` initial values: haiku `1 / 5 / 1.25 / 0.10`, sonnet `3 / 15 / 3.75 / 0.30`. The user must verify these.
  - `rateOf(modelId: string): { family: 'haiku' | 'sonnet'; rates: Rates } | null` (matches `/haiku/i` or `/sonnet/i` in the id)
  - `tokenCost(r: Rates, u: { input: number; output: number; cacheCreation: number; cacheRead: number }): number`
  - `interface SessionAudit { version: number; sessionId: string; projectId: string; projectName: string; analyzedAt: string | null; source: { logBytes: number }; totals: { turns: number; costUsd: number; unpricedTurns: number; priceDrift: number | null }; compacts: AuditCompact[]; routing: AuditRouting[]; handoff: AuditHandoff }`
  - `AuditCompact { startedAt: string; by: 'user' | 'deck-auto' | 'cli-auto'; outcome: 'done' | 'failed'; durationMs: number | null; preTokens: number | null; postTokens: number | null; turnCostUsd: number; nextTurnCacheCreation: number | null; model: string | null; turnsAfter: number }`
  - `AuditRouting { ts: string; model: 'haiku' | 'sonnet'; source: string; classifierCostUsd: number; durationMs: number; spent: { model: string; usage: ModelUsage } | null }`
  - `AuditHandoff { generated: Array<{ ts: string; costUsd: number; enriched: boolean; ctxTokens: number | null }>; from: { sessionId: string; trigger: string | null } | null; to: Array<{ sessionId: string; trigger: string | null }>; firstTurnCacheCreation: number | null; firstCtxTokens: number | null; turnsInSession: number }`
  - `buildSessionAudit(lines: SessionLogLine[], meta: { sessionId: string; projectId: string; projectName: string; logBytes: number }): SessionAudit` (`analyzedAt` always `null`)

- [ ] **Step 1: Write failing tests** (hand-built `SessionLogLine[]`):
  - `compact heartbeats collapse into one compact`: lines `compact started by deck-auto`, two more `started by cli-auto`, then `done preTokens 62152 postTokens 14114` -> `compacts.length === 1`, `by === 'deck-auto'`, `preTokens === 62152`.
  - `failed compact counts as failed with zero cost`: one `started` then `failed` -> `outcome === 'failed'`, `turnCostUsd === 0`, `preTokens === null`.
  - `compact cost and turns after`: `done`, then `turn.completed` (cost 0.5), `context.usage`, two more `turn.completed` -> `turnCostUsd === 0.5`, `turnsAfter === 3`, `nextTurnCacheCreation` equals that first turn's `cacheCreation`.
  - `routing pairs a verdict with the next turn`: `routing.classified {model:'haiku', source:'haiku', costUsd:0.004, durationMs:5000}` then `turn.completed` with `modelUsage` for a haiku id -> `routing[0].spent.model` is that id and `classifierCostUsd === 0.004`.
  - `unknown model is unpriced, not an error`: a turn whose only `modelUsage` key is `'synthetic'` -> `totals.unpricedTurns === 1`, no throw.
  - `empty log yields an empty audit`: `buildSessionAudit([], meta)` -> all arrays empty, `totals.turns === 0`, `priceDrift === null`.
  - `priceDrift compares table to measured cost`: one haiku turn whose `costUsd` equals `tokenCost(RATES.haiku, usage)` -> `priceDrift` is `0` (within 1e-9).
  - `handoff lines are collected`: `handoff.generated`, `handoff.to`, `handoff.from` -> mapped into `handoff`; `firstCtxTokens` is the first `context.usage.totalTokens`; `turnsInSession` counts `turn.completed`.
  - `report holds no message text`: a `user.message` with text `SECRET-TEXT` and a `tool.result` output -> `JSON.stringify(audit)` does not include `SECRET-TEXT`.
- [ ] **Step 2: Run** `npm test`, confirm failures.
- [ ] **Step 3: Implement** `buildSessionAudit` as a single pass over `lines`. Per-turn cost = sum of `modelUsage[*].costUsd`. `context.usage` follows its `turn.completed`. `priceDrift` = relative |sum(table cost) - sum(measured cost)| / sum(measured) over priced turns, `null` when none. A compact's `turnCostUsd` is the cost of the first `turn.completed` after its `done`.
- [ ] **Step 4: Run** `npm test`, all pass; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(audit): derive per-session audit facts from the session log`.

---

### Task 3: Verdicts (`audit-verdict.ts`)

**Files:**
- Create: `server/src/audit-verdict.ts`
- Test: `server/test/unit.test.ts`

**Interfaces:**
- Consumes: `SessionAudit`, `RATES`, `rateOf`, `tokenCost` from `./audit`.
- Produces:
  - `type Verdict = 'saved' | 'break-even' | 'cost more' | 'not enough data'`
  - `interface FeatureVerdict { verdict: Verdict; n: number; costUsd: number; savedUsd: number; netUsd: number; basis: 'estimated'; notes: string[] }` where `netUsd = savedUsd - costUsd`
  - `interface CompactBucket { label: string; n: number; netUsd: number }`
  - `interface AuditVerdicts { sessions: number; compact: FeatureVerdict & { buckets: CompactBucket[]; byActor: Record<string, number>; failed: number }; routing: FeatureVerdict & { bySource: Record<string, number>; fallbackShare: number | null }; handoff: FeatureVerdict & { breakEvenTurns: number | null; actualTurns: number | null; quality: 'not measured' }; priceDrift: number | null; unpricedTurns: number }`
  - `verdicts(audits: SessionAudit[]): AuditVerdicts`
  - `renderSummary(v: AuditVerdicts): string` (terminal text)
- Constants (my calls, exported for tests): `MIN_SAMPLE = 5` (below: `not enough data`), `TIE_BAND = 0.10` (|net| <= 10% of cost: `break-even`), `COMPACT_BUCKETS = [0, 50_000, 100_000]` (lower bounds of `<50k`, `50-100k`, `>=100k` by `preTokens`).

Rules (all savings are `estimated`):
- **Compact** (only `done`; `failed` only counted): `cost = turnCostUsd + postTokens*(cacheWrite - cacheRead)/1e6` (one cache rebuild, at the rates of the compact's model family); `saved = (preTokens - postTokens)*cacheRead/1e6 * turnsAfter`. Skip entries with unknown model family or null tokens (note it).
- **Routing**: `cost = Σ classifierCostUsd`; `saved = Σ over turns routed to haiku with a priced spend of (tokenCost(RATES.sonnet, usage) - actual costUsd)`. Turns routed to sonnet save nothing. `fallbackShare` = share of verdicts with `source === 'fallback'`.
- **Handoff**: for each session with `handoff.from` (new side) matched to its origin (by `sessionId`, both reports needed, else skipped with a note): `cost = Σ origin.generated.costUsd + firstTurnCacheCreation*cacheWrite/1e6`; `perTurn = max(0, originCtx - firstCtxTokens)*cacheRead/1e6` with `originCtx` = last `generated.ctxTokens` non-null; `saved = perTurn * turnsInSession`; `breakEvenTurns = cost / perTurn` or `null` when `perTurn === 0`.
- Verdict from `n < MIN_SAMPLE` -> `not enough data`; else by `net` vs `TIE_BAND * cost` (net > band: `saved`; net < -band: `cost more`; else `break-even`).

- [ ] **Step 1: Write failing tests** with minimal hand-built `SessionAudit` objects:
  - `compact saves when many turns follow`: pre 100k, post 20k, 40 turns after, cost small -> `saved`; `netUsd > 0`.
  - `compact costs more when no turns follow`: `turnsAfter: 0` x5 -> `cost more`.
  - `compact with equal pre and post is a zero saving`: `savedUsd === 0`, no `NaN` anywhere (`Number.isFinite` on every numeric field).
  - `compact failed is counted, not priced`: `failed === 1`, `costUsd === 0` contribution.
  - `fewer than MIN_SAMPLE is not enough data`.
  - `routing: haiku turns save vs sonnet price, classifier cost subtracts`: assert `savedUsd` equals the table-computed Sonnet cost minus actual, `costUsd` equals the sum of classifier costs.
  - `routing fallbackShare` equals fallback count / total.
  - `handoff break-even`: origin ctx 150k, new first ctx 15k, cost known -> `breakEvenTurns` equals `cost/perTurn`; `perTurn === 0` -> `breakEvenTurns === null`.
  - `handoff quality is always not measured`.
  - `renderSummary` contains each of the three feature names and the words `estimated` and `not measured`.
- [ ] **Step 2: Run** `npm test`, confirm failures.
- [ ] **Step 3: Implement** `verdicts` and `renderSummary` per the rules above; one small helper `classify(n, cost, net): Verdict` shared by the three features.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`, all pass.
- [ ] **Step 5: Commit** `feat(audit): compute compact, routing and handoff verdicts`.

---

### Task 4: Storage, archive hook, script, docs

**Files:**
- Create: `server/src/audit-store.ts`, `server/scripts/audit.ts`
- Modify: `server/src/routes.ts` (`PATCH /sessions/:id`), `package.json` (script `"audit": "tsx server/scripts/audit.ts"`), `docs/backend.md`, `docs/testing.md`
- Test: `server/test/unit.test.ts`

**Interfaces:**
- Consumes: `buildSessionAudit`, `ANALYSIS_VERSION`, `SessionAudit` (Task 2); `verdicts`, `renderSummary` (Task 3); `readSessionLog`, `DATA_DIR`.
- Produces (`audit-store.ts`):
  - `slugify(name: string): string` -> lowercase, `[a-z0-9-]` only, collapsed dashes, max 60 chars, `'project'` when empty
  - `auditDir(projectName: string, sessionId: string): string` -> `<DATA_DIR>/audit/<slug>/<sessionId>`
  - `refreshSessionAudit(meta: { sessionId: string; projectId: string; projectName: string }, opts?: { force?: boolean }): Promise<SessionAudit | null>` -> reads the log; if no log returns `null`; skips the rebuild when an existing `audit.json` has the same `ANALYSIS_VERSION` and `source.logBytes` (keeping its `analyzedAt`); else writes `audit.json` and a short `audit.md`
  - `readAllAudits(): Promise<SessionAudit[]>` -> every `audit/*/*/audit.json`, unreadable files skipped
  - `markAnalyzed(audits: SessionAudit[]): Promise<void>` -> sets `analyzedAt` (now) on the ones with `null` and rewrites them

- [ ] **Step 1: Write failing tests** (temp `CCUI_DATA_DIR`, as the existing tests do):
  - `slugify is path-safe`: `'../../etc/passwd'`, `'a/b'`, `'  '`, `'Meu Projeto!'` -> results match `/^[a-z0-9-]+$/` and never contain `..` or `/`; the last is `'meu-projeto'`; empty becomes `'project'`.
  - `refreshSessionAudit writes then skips when unchanged`: first call writes `audit.json` under `auditDir`; second call with the same log leaves the file's mtime and `analyzedAt` untouched; appending a log line makes the third call rewrite it.
  - `refreshSessionAudit returns null without a log`.
  - `markAnalyzed sets analyzedAt once`: second call keeps the first timestamp.
- [ ] **Step 2: Run** `npm test`, confirm failures.
- [ ] **Step 3: Implement** `audit-store.ts` (atomic write via tmp + rename, dirs `0o700`, files `0o600`, like `session-log.ts`).
- [ ] **Step 4: Archive hook.** In `PATCH /sessions/:id`, after `store.sessions.save()`, when `b.archived === true` call `void refreshSessionAudit({ sessionId, projectId, projectName })` with `.catch(console.error)`; it must never change the response. Use the project's name from `store`.
- [ ] **Step 5: Script** `server/scripts/audit.ts`, flags `--reanalyze` (force rebuild and clear `analyzedAt`), `--project <name>` (filter by slug). Flow: read `sessions.json` + `projects.json` from `DATA_DIR` (via `JsonFile`/`store` helpers already used elsewhere), backfill: `refreshSessionAudit` for every session that has a log; `readAllAudits()`; filter; `verdicts()`; print `renderSummary()`; print `N new session(s) analyzed, M already analyzed`; write `<DATA_DIR>/audit/summary.json`; `markAnalyzed`. Exit code 0.
- [ ] **Step 6: Manual check** against the real data dir: `npm run audit`. Expect a summary with compacts near 18 `done` (not 100+), a `priceDrift` figure, and handoff `not enough data` (no links recorded yet). Report `priceDrift` to the user; if it exceeds ~5%, the rate table needs correcting.
- [ ] **Step 7: Docs.** `docs/backend.md`: add the three audit modules and the archive hook; `docs/testing.md`: `npm run audit` (free, no Claude process). Keep each to a few lines.
- [ ] **Step 8: Verify** `npm run typecheck && npm test` pass.
- [ ] **Step 9: Commit** `feat(audit): write audit reports on archive and add npm run audit` (after the full gate incl. `npm run test:live`).
