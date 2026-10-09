import { redactDeep, type RedactionCounts } from './redact';
import type { Transcript } from './runtime/types';
import type { SessionLogLine } from './session-log';

// Session export: one NDJSON file for another AI to analyze (what was said/done, where the tokens went).
// Line 1 = manifest (how to read it + aggregates), then the merged timeline: the Claude Code transcript (+ subagents)
// and the Deck's own session log, ordered by timestamp. Pure function: the route does the IO.

export interface ExportInput {
  session: { sessionId: string; name: string; settings: Record<string, unknown> };
  deckLog: SessionLogLine[];
  transcript: Transcript | null;
  redact: boolean;
  now?: Date;
}

// content-free bookkeeping the transcript writes; counted in the manifest, not exported
const BOOKKEEPING = new Set(['file-history-snapshot', 'file-history-delta', 'last-prompt', 'atis-latch', 'mode', 'permission-mode', 'ai-title', 'agent-name', 'custom-title']);
// Deck events whose content the transcript already holds; dropped only when the transcript is present
const IN_TRANSCRIPT = new Set(['user.message', 'message.completed', 'tool.started', 'tool.result']);
// per-line envelope noise of a transcript entry (the manifest/timeline carry what matters)
const ENVELOPE = ['parentUuid', 'logicalParentUuid', 'isSidechain', 'userType', 'entrypoint', 'cwd', 'version', 'gitBranch', 'sessionId', 'requestId', 'slug'];

export interface Entry {
  type?: string; subtype?: string; timestamp?: string; uuid?: string; isMeta?: boolean; sourceToolUseID?: string; durationMs?: number;
  message?: { id?: string; model?: string; content?: unknown; usage?: Usage };
  attachment?: Record<string, unknown>; content?: unknown; compactMetadata?: Record<string, unknown>;
  [k: string]: unknown;
}
interface Usage {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
}
interface Part { origin: string; bytes: number; calls?: number; durationMs?: number; overlap?: boolean }
interface Agg { calls: number; bytes: number; durationMs: number }

const size = (v: unknown) => (v === undefined ? 0 : Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v)));
const iso = (ms: number) => new Date(ms).toISOString();

const README = [
  'This file is an export of ONE Claude Code session run through Claude Deck (a web UI for Claude Code). It is meant to be analyzed by an AI.',
  'Goal: find where tokens are wasted and what to change (prompts, skills, plugins, hooks, MCP servers, context management, model choice).',
  'Format: NDJSON. Line 1 is this manifest. Every other line is a timeline event ordered by time; `src` says who wrote it.',
  '`src:"claude"` = a line of the Claude Code transcript (full content kept): `type` user|assistant|attachment|system|cost-state; `agent` is set when it came from a subagent; `origins` and `bytes` classify it; `entry` is the original line.',
  '`src:"deck"` = what the Claude Deck app itself did or saw: `kind` is an event type (session.state, turn.completed, permission.requested, compact, error...), `action` (interrupt, reload, stopTask, mcp), `process.open|process.exit` (with the effective settings), `routing.classified`, `compact.requested|compact.declined`.',
  'Origins: skill:<name>, mcp:<server>, subagent:<type>, tool:<name> (built-in tools), hook:<event[:command]>, system:<kind> (injected context such as skill_listing, instructions, deferred_tools_*), user, assistant:text|thinking.',
  '`byOrigin` aggregates calls, bytes of recorded content and estimated tokens (bytes/4: an ESTIMATE, not billing). hook_success output overlaps hook_additional_context, so its bytes are listed on the line but not summed.',
  '`tokens` are REAL values from each assistant message `usage` (deduplicated by message id): input, output, thinking, cache read/creation. cacheHitRatio = cacheRead / (cacheRead + cacheCreation + input).',
  'Cost figures are API-price estimates, not subscription billing. `routing` = Claude Deck picks Haiku or Sonnet per message (the classifier call itself costs a little). `compactions` lists /compact runs and who asked (user, deck-auto = Claude Deck asked after the user accepted its prompt, cli-auto = the CLI did it by itself).',
  'Things worth checking: huge system/hook/skill_listing injections repeated each session start, tools returning very large outputs, repeated reads of the same files, low cache hit ratio, long contexts before compaction, thinking-heavy turns, expensive models on simple prompts, subagents that re-read what the parent already had.',
  'Secrets: if redaction.enabled, known secret shapes were replaced by [REDACTED:<type>] (best effort, not a guarantee).',
].join('\n');

/** `a:b` skills and `plugin_<name>_<server>` MCP servers carry the plugin name; everything else is unattributed */
function pluginOf(origin: string): string | undefined {
  if (origin.startsWith('skill:')) { const n = origin.slice(6); return n.includes(':') ? n.split(':')[0] : undefined; }
  if (origin.startsWith('mcp:plugin_')) return origin.slice(4).split('_')[1];
  return undefined;
}

function toolOrigin(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === 'Skill') return `skill:${String(i.skill ?? 'unknown')}`;
  if (name === 'Task' || name === 'Agent') return `subagent:${String(i.subagent_type ?? 'general-purpose')}`;
  if (name.startsWith('mcp__')) return `mcp:${name.split('__')[1] ?? 'unknown'}`;
  return `tool:${name}`;
}

export const parse = (text: string): Entry[] => text.split('\n').flatMap((l) => { try { return l ? [JSON.parse(l) as Entry] : []; } catch { return []; } });

export function buildExport(input: ExportInput): string {
  const counts: RedactionCounts = {};
  const red = <T>(v: T): T => (input.redact ? redactDeep(v, counts) : v);
  const agg = new Map<string, Agg>();
  const add = (p: Part) => {
    const a = agg.get(p.origin) ?? { calls: 0, bytes: 0, durationMs: 0 };
    a.calls += p.calls ?? 0; a.durationMs += p.durationMs ?? 0;
    if (!p.overlap) a.bytes += p.bytes;
    agg.set(p.origin, a);
  };

  // ---- transcript (main + subagents) ----
  const sources: Array<{ agent?: string; entries: Entry[] }> = [];
  const subagentInfo: Array<Record<string, unknown>> = [];
  if (input.transcript) {
    sources.push({ entries: parse(input.transcript.main) });
    for (const s of input.transcript.subagents) {
      let meta: Record<string, unknown> = {};
      try { meta = s.meta ? JSON.parse(s.meta) : {}; } catch { /* meta is optional */ }
      const entries = parse(s.jsonl);
      sources.push({ agent: s.id, entries });
      subagentInfo.push({ id: s.id, agentType: meta.agentType, description: meta.description, toolUseId: meta.toolUseId, lines: entries.length });
    }
  }

  const timeline: Array<{ t: number; line: Record<string, unknown> }> = [];
  const toolOrigins = new Map<string, string>(); // tool_use id -> origin, to attribute the matching tool_result
  const hookCommands = new Map<string, string>(); // hook toolUseID -> its command
  const usageByMsg = new Map<string, { t: number; agent: string; model: string; u: Usage }>();
  const dropped: Record<string, number> = {};
  const compactions: Array<Record<string, unknown>> = [];
  let transcriptLines = 0;
  let lastCostState: Entry | null = null;

  for (const src of sources) {
    let lastT = 0;
    for (const e of src.entries) {
      if (e.type && BOOKKEEPING.has(e.type)) { dropped[e.type] = (dropped[e.type] ?? 0) + 1; continue; }
      transcriptLines++;
      const parsedT = e.timestamp ? Date.parse(e.timestamp) : NaN;
      const t = Number.isFinite(parsedT) ? parsedT : lastT;
      lastT = t;
      const parts: Part[] = [];
      const agent = src.agent;

      if (e.type === 'assistant' && e.message) {
        const blocks = Array.isArray(e.message.content) ? e.message.content as Array<Record<string, unknown>> : [];
        for (const b of blocks) {
          if (b.type === 'tool_use') {
            const origin = toolOrigin(String(b.name), b.input);
            if (typeof b.id === 'string') toolOrigins.set(b.id, origin);
            parts.push({ origin, bytes: size(b.input) + size(b.name), calls: 1 });
          } else if (b.type === 'thinking') parts.push({ origin: 'assistant:thinking', bytes: size(b.thinking) });
          else if (b.type === 'text') parts.push({ origin: 'assistant:text', bytes: size(b.text) });
        }
        if (e.message.id && e.message.usage) usageByMsg.set(e.message.id, { t, agent: agent ?? 'main', model: e.message.model ?? 'unknown', u: e.message.usage });
      } else if (e.type === 'user' && e.message) {
        const c = e.message.content;
        const meta = e.sourceToolUseID ? toolOrigins.get(e.sourceToolUseID) : undefined;
        if (typeof c === 'string') parts.push({ origin: meta ?? (e.isMeta ? 'user:meta' : 'user'), bytes: size(c) });
        else if (Array.isArray(c)) {
          for (const b of c as Array<Record<string, unknown>>) {
            if (b.type === 'tool_result') parts.push({ origin: toolOrigins.get(String(b.tool_use_id)) ?? 'tool:unknown', bytes: size(b.content) });
            else parts.push({ origin: meta ?? (e.isMeta ? 'user:meta' : 'user'), bytes: size(b.type === 'text' ? b.text : b) });
          }
        }
      } else if (e.type === 'attachment' && e.attachment) {
        const a = e.attachment;
        const at = String(a.type ?? 'unknown');
        if (at.startsWith('hook_') || at === 'async_hook_response') {
          const id = String(a.toolUseID ?? '');
          if (at === 'hook_success' && typeof a.command === 'string') hookCommands.set(id, a.command);
          const cmd = hookCommands.get(id);
          const origin = `hook:${String(a.hookName ?? a.hookEvent ?? at)}${cmd ? `:${cmd.slice(0, 80)}` : ''}`;
          if (at === 'hook_success') parts.push({ origin, bytes: size(a.stdout) + size(a.stderr), calls: 1, durationMs: Number(a.durationMs) || 0, overlap: true });
          else parts.push({ origin, bytes: size(a.content ?? a) });
        } else parts.push({ origin: `system:${at}`, bytes: size(a) });
      } else if (e.type === 'cost-state') {
        lastCostState = e;
        parts.push({ origin: 'system:cost-state', bytes: size(e) });
      } else {
        const kind = e.type === 'system' && e.subtype ? e.subtype : (e.type ?? 'unknown');
        parts.push({ origin: `system:${kind}`, bytes: size(e.content ?? e), durationMs: e.subtype === 'turn_duration' ? e.durationMs : undefined });
        if (e.subtype === 'compact_boundary') compactions.push({ ts: iso(t), src: 'claude', ...e.compactMetadata });
      }

      for (const p of parts) add(p);
      const stripped: Record<string, unknown> = { ...e };
      for (const k of ENVELOPE) delete stripped[k];
      timeline.push({
        t,
        line: {
          src: 'claude', ts: iso(t), type: e.type, ...(e.subtype ? { subtype: e.subtype } : {}), ...(agent ? { agent } : {}),
          origins: [...new Set(parts.map((p) => p.origin))], bytes: parts.reduce((n, p) => n + p.bytes, 0), entry: red(stripped),
        },
      });
    }
  }

  // ---- Deck-side log ----
  const hasTranscript = !!input.transcript;
  const deckKinds: Record<string, number> = {};
  const routing = { bySourceModel: {} as Record<string, number>, costUsd: 0, durationMs: 0, calls: 0 };
  let deckLines = 0;
  for (const d of input.deckLog) {
    if (hasTranscript && IN_TRANSCRIPT.has(d.kind)) { dropped['deck:duplicated-in-transcript'] = (dropped['deck:duplicated-in-transcript'] ?? 0) + 1; continue; }
    deckLines++;
    deckKinds[d.kind] = (deckKinds[d.kind] ?? 0) + 1;
    const t = Date.parse(d.ts);
    if (d.kind === 'routing.classified') {
      const key = `${d.source}:${d.model}`;
      routing.bySourceModel[key] = (routing.bySourceModel[key] ?? 0) + 1;
      routing.costUsd += Number(d.costUsd) || 0; routing.durationMs += Number(d.durationMs) || 0; routing.calls++;
    }
    if (d.kind === 'compact.requested' || d.kind === 'compact.declined' || (d.kind === 'compact' && d.phase !== undefined)) {
      const { kind, ...rest } = d;
      compactions.push({ src: 'deck', event: kind, ...rest });
    }
    timeline.push({ t: Number.isFinite(t) ? t : 0, line: red({ src: 'deck', ...d }) });
  }

  // ---- tokens (real usage, once per message id) ----
  const zero = () => ({ messages: 0, input: 0, output: 0, thinking: 0, cacheRead: 0, cacheCreation: 0 });
  const byModel: Record<string, ReturnType<typeof zero>> = {};
  const byAgent: Record<string, ReturnType<typeof zero>> = {};
  const total = zero();
  const series: Array<Array<string | number>> = [];
  for (const m of [...usageByMsg.values()].sort((a, b) => a.t - b.t)) {
    const row = [iso(m.t), m.agent, m.model, m.u.input_tokens ?? 0, m.u.output_tokens ?? 0, m.u.cache_read_input_tokens ?? 0, m.u.cache_creation_input_tokens ?? 0, m.u.output_tokens_details?.thinking_tokens ?? 0];
    series.push(row);
    for (const bucket of [(byModel[m.model] ??= zero()), (byAgent[m.agent] ??= zero()), total]) {
      bucket.messages++; bucket.input += row[3] as number; bucket.output += row[4] as number;
      bucket.cacheRead += row[5] as number; bucket.cacheCreation += row[6] as number; bucket.thinking += row[7] as number;
    }
  }
  const denom = total.cacheRead + total.cacheCreation + total.input;

  // ---- assemble ----
  timeline.sort((a, b) => a.t - b.t); // stable: ties keep file order
  const byOrigin = [...agg.entries()].map(([origin, a]) => ({ origin, plugin: pluginOf(origin), ...a, estTokens: Math.ceil(a.bytes / 4) })).sort((a, b) => b.bytes - a.bytes);
  compactions.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const times = timeline.map((x) => x.t).filter((t) => t > 0);
  const manifestBody = {
    type: 'manifest', schema: 'claude-deck-session-export/1', generatedAt: (input.now ?? new Date()).toISOString(), readme: README,
    session: { ...input.session, firstEventAt: times.length ? iso(times[0]) : null, lastEventAt: times.length ? iso(times[times.length - 1]) : null },
    sources: { transcriptAvailable: hasTranscript, transcriptLines, deckLines, subagents: subagentInfo },
    byOrigin,
    tokens: {
      total, cacheHitRatio: denom ? Number((total.cacheRead / denom).toFixed(4)) : null, byModel, byAgent,
      series: { columns: ['ts', 'agent', 'model', 'input', 'output', 'cacheRead', 'cacheCreation', 'thinking'], rows: series },
    },
    costState: lastCostState,
    compactions,
    routing,
    deckKinds,
    dropped,
  };
  const manifest = { ...red(manifestBody), redaction: { enabled: input.redact, counts } }; // counts are final: every line is already redacted
  const lines = [manifest, ...timeline.map((x) => x.line)];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}
