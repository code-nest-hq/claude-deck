import { RATES, type ModelUsage, type Rates } from '@ccui/shared';
import type { SessionLogLine } from './session-log';

// Token audit, per-session facts: a pure pass over one session log (session-log.ts) that keeps only numbers and ids, no
// message text. audit-verdict.ts turns many of these into verdicts; audit-store.ts persists them.

export { RATES, type Rates };
export const ANALYSIS_VERSION = 2; // bump when the facts or RATES change: reports of an older version are rebuilt

export function rateOf(modelId: string): { family: 'haiku' | 'sonnet'; rates: Rates } | null {
  const family = /haiku/i.test(modelId) ? 'haiku' : /sonnet/i.test(modelId) ? 'sonnet' : null;
  return family ? { family, rates: RATES[family] } : null;
}
export function tokenCost(r: Rates, u: { input: number; output: number; cacheCreation: number; cacheRead: number }): number {
  return (u.input * r.input + u.output * r.output + u.cacheCreation * r.cacheWrite + u.cacheRead * r.cacheRead) / 1e6;
}

export interface AuditCompact {
  startedAt: string; by: 'user' | 'deck-auto' | 'cli-auto'; outcome: 'done' | 'failed'; durationMs: number | null;
  preTokens: number | null; postTokens: number | null;
  turnCostUsd: number; nextTurnCacheCreation: number | null; model: string | null;
  /** turns recorded after this compact until the next one; the first is the compact's own turn */
  turnsAfter: number;
}
export interface AuditRouting {
  ts: string; model: 'haiku' | 'sonnet'; source: string; classifierCostUsd: number; durationMs: number;
  spent: { model: string; usage: ModelUsage } | null;
}
export interface AuditHandoff {
  generated: Array<{ ts: string; costUsd: number; enriched: boolean; ctxTokens: number | null }>;
  from: { sessionId: string; trigger: string | null } | null;
  to: Array<{ sessionId: string; trigger: string | null; /** origin context size when the new session was created */ ctxTokens: number | null }>;
  firstTurnCacheCreation: number | null; firstCtxTokens: number | null; turnsInSession: number;
}
export interface SessionAudit {
  version: number; sessionId: string; projectId: string; projectName: string;
  /** null until `npm run audit` has included this report */ analyzedAt: string | null;
  source: { logBytes: number };
  totals: { turns: number; costUsd: number; unpricedTurns: number; /** |table - measured| / measured over priced turns */ priceDrift: number | null };
  compacts: AuditCompact[]; routing: AuditRouting[]; handoff: AuditHandoff;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function buildSessionAudit(lines: SessionLogLine[], meta: { sessionId: string; projectId: string; projectName: string; logBytes: number }): SessionAudit {
  const out: SessionAudit = {
    version: ANALYSIS_VERSION, sessionId: meta.sessionId, projectId: meta.projectId, projectName: meta.projectName, analyzedAt: null,
    source: { logBytes: meta.logBytes },
    totals: { turns: 0, costUsd: 0, unpricedTurns: 0, priceDrift: null },
    compacts: [], routing: [],
    handoff: { generated: [], from: null, to: [], firstTurnCacheCreation: null, firstCtxTokens: null, turnsInSession: 0 },
  };
  let open: AuditCompact | null = null; // a compact in flight: repeated `started` lines (CLI heartbeat) are the same compact
  let last: AuditCompact | null = null; // the latest finished compact, collecting its turns
  let lastFresh = false;                // its own turn has not been seen yet
  let awaiting: AuditRouting | null = null;
  let measured = 0; let table = 0;

  for (const l of lines) {
    switch (l.kind) {
      case 'compact': {
        if (l.phase === 'started') {
          open ??= { startedAt: l.ts, by: l.by === 'user' || l.by === 'deck-auto' ? l.by : 'cli-auto', outcome: 'done', durationMs: null, preTokens: null, postTokens: null, turnCostUsd: 0, nextTurnCacheCreation: null, model: null, turnsAfter: 0 };
        } else if (l.phase === 'done' || l.phase === 'failed') {
          const c: AuditCompact = open ?? { startedAt: l.ts, by: 'cli-auto', outcome: 'done', durationMs: null, preTokens: null, postTokens: null, turnCostUsd: 0, nextTurnCacheCreation: null, model: null, turnsAfter: 0 };
          c.outcome = l.phase;
          c.durationMs = Date.parse(l.ts) - Date.parse(c.startedAt);
          if (l.phase === 'done') { c.preTokens = num(l.preTokens, NaN); c.postTokens = num(l.postTokens, NaN); if (Number.isNaN(c.preTokens) || Number.isNaN(c.postTokens)) c.preTokens = c.postTokens = null; }
          out.compacts.push(c);
          open = null;
          if (l.phase === 'done') { last = c; lastFresh = true; }
        }
        break;
      }
      case 'routing.classified': {
        awaiting = { ts: l.ts, model: l.model === 'haiku' ? 'haiku' : 'sonnet', source: str(l.source) ?? 'unknown', classifierCostUsd: num(l.costUsd), durationMs: num(l.durationMs), spent: null };
        out.routing.push(awaiting);
        break;
      }
      case 'turn.completed': {
        const mu = (l.modelUsage ?? {}) as Record<string, ModelUsage>;
        const entries = Object.entries(mu);
        const cost = entries.reduce((a, [, u]) => a + num(u.costUsd), 0);
        out.totals.turns++; out.totals.costUsd += cost; out.handoff.turnsInSession++;
        let priced = false;
        for (const [id, u] of entries) {
          const r = rateOf(id);
          if (!r) continue;
          priced = true; measured += num(u.costUsd); table += tokenCost(r.rates, { input: num(u.input), output: num(u.output), cacheCreation: num(u.cacheCreation), cacheRead: num(u.cacheRead) });
        }
        if (entries.length && !priced) out.totals.unpricedTurns++;
        const top = entries.sort((a, b) => num(b[1].costUsd) - num(a[1].costUsd))[0];
        const cacheCreation = entries.reduce((a, [, u]) => a + num(u.cacheCreation), 0);
        if (out.handoff.turnsInSession === 1) out.handoff.firstTurnCacheCreation = cacheCreation;
        if (awaiting && top) { awaiting.spent = { model: top[0], usage: top[1] }; }
        awaiting = null;
        if (last) {
          last.turnsAfter++;
          if (lastFresh) { last.turnCostUsd = cost; last.nextTurnCacheCreation = cacheCreation; last.model = top?.[0] ?? null; lastFresh = false; }
        }
        break;
      }
      case 'context.usage':
        out.handoff.firstCtxTokens ??= num(l.totalTokens, NaN);
        if (Number.isNaN(out.handoff.firstCtxTokens)) out.handoff.firstCtxTokens = null;
        break;
      case 'handoff.generated':
        out.handoff.generated.push({ ts: l.ts, costUsd: num(l.costUsd), enriched: !!l.enriched, ctxTokens: typeof l.ctxTokens === 'number' ? l.ctxTokens : null });
        break;
      case 'handoff.from': { const id = str(l.sessionId); if (id) out.handoff.from = { sessionId: id, trigger: str(l.trigger) }; break; }
      case 'handoff.to': { const id = str(l.sessionId); if (id) out.handoff.to.push({ sessionId: id, trigger: str(l.trigger), ctxTokens: typeof l.ctxTokens === 'number' ? l.ctxTokens : null }); break; }
    }
  }
  if (measured > 0) out.totals.priceDrift = Math.abs(table - measured) / measured;
  return out;
}
