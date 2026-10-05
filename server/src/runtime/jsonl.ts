import { type HistoryItem, type ModelUsage, type UsageTotals } from '@ccui/shared';
import { blockText, cleanTags, rawModelUsage, sumUsage } from './events';

interface Entry { type?: string; uuid?: string; timestamp?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } }

// jsonl do Claude Code -> histórico de texto (mesmo formato que o getSessionMessages local entrega)
export function parseHistory(jsonl: string): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let e: Entry;
    try { e = JSON.parse(line); } catch { continue; } // linha cortada por head/tail
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || e.isMeta) continue;
    const text = cleanTags(blockText(e.message?.content));
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (text) out.push({ role: e.type, text, ...(Number.isFinite(ts) ? { ts } : {}) });
  }
  return out;
}

// uuid -> epoch ms of each user/assistant entry (the local history comes from the SDK, which drops the timestamp)
export function jsonlTimestamps(jsonl: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"timestamp"')) continue;
    try {
      const e = JSON.parse(line) as Entry;
      const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
      if (e.uuid && Number.isFinite(ts)) out.set(e.uuid, ts);
    } catch { /* partial line */ }
  }
  return out;
}

export const firstPrompt = (jsonl: string): string | undefined => parseHistory(jsonl).find((h) => h.role === 'user')?.text.slice(0, 80);

// Última linha `cost-state` do jsonl: acumulado da sessão (custo e tokens, total e por modelo), inclusive de execuções anteriores.
// `modelUsage` semeia o snapshot de hub.ts pra calcular o delta do 1º turno depois de reabrir/reiniciar (sem isso, o 1º
// resumo de turno mostraria o acumulado da sessão inteira em vez do custo só daquela interação).
export function lastCostState(jsonlTail: string): { totals: UsageTotals; modelUsage: Record<string, ModelUsage> } | null {
  const lines = jsonlTail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"cost-state"')) continue;
    try {
      const e = JSON.parse(lines[i]) as { type?: string; totalCostUSD?: number; modelUsage?: Parameters<typeof sumUsage>[0] };
      if (e.type === 'cost-state') return { totals: sumUsage(e.modelUsage, e.totalCostUSD ?? 0), modelUsage: rawModelUsage(e.modelUsage) };
    } catch { /* linha cortada no começo do trecho lido */ }
  }
  return null;
}

/** marker line `readTranscript` prints (over SSH) before each subagent file */
export const FILE_MARK = '@@CCUI-FILE@@ ';

// one ssh stdout: the main jsonl, then for each subagent file `\n<FILE_MARK><path>\n<content>`
export function parseRemoteTranscript(stdout: string): { main: string; subagents: Array<{ id: string; meta: string | null; jsonl: string }> } {
  const [main, ...files] = stdout.split('\n' + FILE_MARK);
  const byId = new Map<string, { id: string; meta: string | null; jsonl: string }>();
  for (const f of files) {
    const nl = f.indexOf('\n');
    const name = (nl < 0 ? f : f.slice(0, nl)).trim().split('/').pop() ?? '';
    const content = nl < 0 ? '' : f.slice(nl + 1);
    const m = /^(agent-.+?)\.(meta\.json|jsonl)$/.exec(name);
    if (!m) continue;
    const row = byId.get(m[1]) ?? { id: m[1], meta: null, jsonl: '' };
    if (m[2] === 'jsonl') row.jsonl = content; else row.meta = content;
    byId.set(m[1], row);
  }
  return { main, subagents: [...byId.values()] };
}
