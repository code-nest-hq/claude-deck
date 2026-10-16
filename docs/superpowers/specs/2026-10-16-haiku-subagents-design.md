# Haiku subagents — design

Date: 2026-10-16. Status: draft, awaiting approval.

## Context

Model Routing (`routing.ts`) picks Haiku vs Sonnet **once per user message**. Everything inside the turn
— file reads, greps, delegated subagents — runs on that one model. A message routed to Sonnet therefore
reads every file on Sonnet, and the Agent tool's built-in subagents inherit the main model.

Goal: cheap, mechanical work (locating code, reading files, summarizing search results) runs on Haiku
even when the main turn is Sonnet.

## Findings

- The SDK has no per-tool-call model switch; a tool call runs inside the main model's turn.
- `AgentDefinition.model` (`'haiku'` etc.) lets a custom subagent run on its own model; the main model
  delegates through the Agent tool. `query({ options: { agents } })` is the only wiring needed
  (`Live` constructor, `sdk-runtime.ts:142`).
- `AgentDefinition.background` runs the subagent non-blocking. Background tasks already surface in the
  UI (`bg.tasks`, `runtime/bg-tasks.ts`), so no protocol change.
- Opus/Fable stay blocked: the new agents hardcode `haiku`, and `forbiddenModel` still checks every message.

## Decision

Opt-in flag, reusing the Model Routing switch: when `routing` is on for the session, `Live` also passes
`agents` with read-only Haiku subagents. No new setting, no new UI, no new layer.

- `haiku-explorer`: tools `Read`, `Grep`, `Glob`, `Bash` (read-only use by prompt), `model: 'haiku'`.
  Description tells the main model to delegate "find where X is defined", "read these files and report
  Y", "list usages of Z". Prompt: answer concisely with `file:line` references, never edit.
- `haiku-runner` (optional, second step): runs a command (tests, build, typecheck) and reports only the
  failing lines. `background: true` is **not** set by default — see Non-goals.
- System prompt `append` (already used for `request_model_upgrade`) gets one sentence telling the main
  model to prefer these agents for exploration/reading instead of reading many files itself.

Permissions are unchanged: subagent tool calls go through the same `canUseTool`.

## Non-goals

- Forcing `run_in_background`: rewriting tool input in `canUseTool` changes turn flow (the model expects
  the result inline). Background stays the model's choice.
- Per-tool-call model switching: not possible in the SDK.
- Changing the per-message heuristic in `routing.ts`.

## Risks

- The main model may ignore the hint and read files itself. Mitigation: the prompt nudge; measure with
  the session export (per-agent token usage is already in the manifest).
- Delegation overhead can cost more than a single small read. The nudge targets multi-file exploration
  only.
- Haiku summaries can miss detail. The main model can still read files directly.

## Changes

1. `server/src/runtime/sdk-runtime.ts`: `agents` constant + spread into `query()` options when `o.routing`;
   extend the `append` sentence.
2. `server/test/`: assert every agent definition has `model: 'haiku'` (never `forbiddenModel`).
3. `docs/architecture.md` §Model Routing: one paragraph.

## Validation

`npm run typecheck`, `npm test`, `npm run test:live` (check in the export manifest that a delegated read
shows `subagent:haiku-explorer` usage on Haiku).
