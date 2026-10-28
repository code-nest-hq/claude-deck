import { RATES, rateOf, tokenCost, type SessionAudit } from './audit';

// Token audit, verdicts: many SessionAudits in, one verdict per feature out. Savings are counterfactual, hence always
// "estimated" (they use the rate table in audit.ts); costs come from the log where the log has them.

export const MIN_SAMPLE = 5;   // below this many cases a feature gets `not enough data`
export const TIE_BAND = 0.1;   // |net| within 10% of the cost is a `break-even`
const BUCKETS: Array<{ label: string; from: number }> = [{ label: '<50k', from: 0 }, { label: '50-100k', from: 50_000 }, { label: '>=100k', from: 100_000 }];

export type Verdict = 'saved' | 'break-even' | 'cost more' | 'not enough data';
export interface FeatureVerdict { verdict: Verdict; n: number; costUsd: number; savedUsd: number; netUsd: number; basis: 'estimated'; notes: string[] }
export interface CompactBucket { label: string; n: number; netUsd: number }
export interface AuditVerdicts {
  sessions: number;
  compact: FeatureVerdict & { buckets: CompactBucket[]; byActor: Record<string, number>; failed: number };
  routing: FeatureVerdict & { bySource: Record<string, number>; fallbackShare: number | null };
  handoff: FeatureVerdict & { breakEvenTurns: number | null; actualTurns: number | null; quality: 'not measured' };
  priceDrift: number | null; unpricedTurns: number;
}

function classify(n: number, cost: number, net: number): Verdict {
  if (n < MIN_SAMPLE) return 'not enough data';
  const band = TIE_BAND * cost;
  return net > band ? 'saved' : net < -band ? 'cost more' : 'break-even';
}
const feature = (n: number, costUsd: number, savedUsd: number, notes: string[]): FeatureVerdict =>
  ({ verdict: classify(n, costUsd, savedUsd - costUsd), n, costUsd, savedUsd, netUsd: savedUsd - costUsd, basis: 'estimated', notes });
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

export function verdicts(audits: SessionAudit[]): AuditVerdicts {
  const byId = new Map(audits.map((a) => [a.sessionId, a]));

  // compact: cost = its own turn + one cache rebuild of the shrunken context; saving = cache reads avoided on every later turn
  let cN = 0; let cCost = 0; let cSaved = 0; let failed = 0; let skipped = 0;
  const byActor: Record<string, number> = {};
  const buckets = BUCKETS.map((b) => ({ ...b, n: 0, net: 0 }));
  for (const a of audits) for (const c of a.compacts) {
    if (c.outcome === 'failed') { failed++; continue; }
    const r = c.model ? rateOf(c.model) : null;
    if (!r || c.preTokens === null || c.postTokens === null) { skipped++; continue; }
    const cost = c.turnCostUsd + (c.postTokens * (r.rates.cacheWrite - r.rates.cacheRead)) / 1e6;
    const saved = (Math.max(0, c.preTokens - c.postTokens) * r.rates.cacheRead / 1e6) * Math.max(0, c.turnsAfter - 1);
    cN++; cCost += cost; cSaved += saved; bump(byActor, c.by);
    const b = [...buckets].reverse().find((x) => c.preTokens! >= x.from)!;
    b.n++; b.net += saved - cost;
  }
  const cNotes = [`${failed} failed compact(s) not priced`, ...(skipped ? [`${skipped} compact(s) skipped (unknown model or missing token counts)`] : [])];

  // routing: saving = what the Haiku-routed turns would have cost at Sonnet prices; cost = the classifier calls
  let rN = 0; let rCost = 0; let rSaved = 0; let fallback = 0;
  const bySource: Record<string, number> = {};
  for (const a of audits) for (const r of a.routing) {
    rN++; rCost += r.classifierCostUsd; bump(bySource, r.source);
    if (r.source === 'fallback') fallback++;
    if (r.model === 'haiku' && r.spent && rateOf(r.spent.model)) rSaved += tokenCost(RATES.sonnet, r.spent.usage) - r.spent.usage.costUsd;
  }

  // handoff: cost = enrich calls + the new session's first-turn cache write; saving = the old context's cache reads not paid per turn
  // (Sonnet rates: the new session's model is not in the log; conservative for the saving, generous for the cost)
  let hN = 0; let hCost = 0; let hSaved = 0; let perTurnSum = 0; let turnsSum = 0; let hSkipped = 0;
  const counted = new Set<string>();
  for (const a of audits) {
    const from = a.handoff.from;
    if (!from) continue;
    const o = byId.get(from.sessionId);
    const ctx = o?.handoff.to.find((t) => t.sessionId === a.sessionId)?.ctxTokens ?? null;
    if (!o || ctx === null || a.handoff.firstCtxTokens === null || a.handoff.firstTurnCacheCreation === null) { hSkipped++; continue; }
    const enrich = counted.has(o.sessionId) ? 0 : o.handoff.generated.reduce((s, g) => s + g.costUsd, 0);
    counted.add(o.sessionId);
    const perTurn = (Math.max(0, ctx - a.handoff.firstCtxTokens) * RATES.sonnet.cacheRead) / 1e6;
    hN++; hCost += enrich + (a.handoff.firstTurnCacheCreation * RATES.sonnet.cacheWrite) / 1e6;
    hSaved += perTurn * a.handoff.turnsInSession; perTurnSum += perTurn; turnsSum += a.handoff.turnsInSession;
  }

  return {
    sessions: audits.length,
    compact: { ...feature(cN, cCost, cSaved, cNotes), failed, byActor, buckets: buckets.map((b) => ({ label: b.label, n: b.n, netUsd: b.net })) },
    routing: { ...feature(rN, rCost, rSaved, []), bySource, fallbackShare: rN ? fallback / rN : null },
    handoff: {
      ...feature(hN, hCost, hSaved, hSkipped ? [`${hSkipped} handoff(s) skipped (origin session or sizes missing)`] : []),
      breakEvenTurns: perTurnSum > 0 ? hCost / perTurnSum : null, actualTurns: hN ? turnsSum / hN : null, quality: 'not measured',
    },
    priceDrift: weighted(audits), unpricedTurns: audits.reduce((s, a) => s + a.totals.unpricedTurns, 0),
  };
}

/** mean of the per-session drifts that exist, weighted by session cost */
function weighted(audits: SessionAudit[]): number | null {
  const withDrift = audits.filter((a) => a.totals.priceDrift !== null && a.totals.costUsd > 0);
  const total = withDrift.reduce((s, a) => s + a.totals.costUsd, 0);
  return total > 0 ? withDrift.reduce((s, a) => s + a.totals.priceDrift! * a.totals.costUsd, 0) / total : null;
}

const usd = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(4)}`;
export function renderSummary(v: AuditVerdicts): string {
  const row = (name: string, f: FeatureVerdict) => `${name.padEnd(9)} ${f.verdict.toUpperCase().padEnd(16)} n=${f.n}  cost ${usd(f.costUsd)}  saved ${usd(f.savedUsd)} (estimated)  net ${usd(f.netUsd)}`;
  const c = v.compact; const r = v.routing; const h = v.handoff;
  return [
    `Token audit: ${v.sessions} session(s)`,
    '',
    row('compact', c),
    `  by actor: ${JSON.stringify(c.byActor)}; failed: ${c.failed}`,
    `  net by context size: ${c.buckets.map((b) => `${b.label} n=${b.n} ${usd(b.netUsd)}`).join(' | ')}`,
    ...c.notes.map((n) => `  note: ${n}`),
    '',
    row('routing', r),
    `  by source: ${JSON.stringify(r.bySource)}; fallback share: ${r.fallbackShare === null ? 'n/a' : `${(r.fallbackShare * 100).toFixed(0)}%`}`,
    '',
    row('handoff', h),
    `  break-even: ${h.breakEvenTurns === null ? 'n/a' : `${h.breakEvenTurns.toFixed(1)} turns`}; actual new-session turns (mean): ${h.actualTurns === null ? 'n/a' : h.actualTurns.toFixed(1)}`,
    `  quality: ${h.quality}`,
    ...h.notes.map((n) => `  note: ${n}`),
    '',
    `Rate table drift vs measured cost: ${v.priceDrift === null ? 'n/a' : `${(v.priceDrift * 100).toFixed(1)}%`}${v.priceDrift !== null && v.priceDrift > 0.05 ? '  (above 5%: check RATES in audit.ts)' : ''}; turns on unknown models: ${v.unpricedTurns}`,
  ].join('\n');
}
