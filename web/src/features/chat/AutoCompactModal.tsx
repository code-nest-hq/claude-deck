import { useEffect, useState } from 'react';
import { fmtTokens } from '../../lib/format';
import type { Chat } from './reduce';

// % of the autocompact window. Past ~60% quality starts degrading (context rot) and every turn re-reads the whole
// context, so compacting here is cheaper and the summary is built from a still-complete context (the CLI's own
// auto-compact only fires near the limit).
export const COMPACT_THRESHOLD = 60;

// context.usage seq already answered (confirmed or cancelled) per session; survives switching sessions
const handled = new Map<string, number>();

// Auto-compact (project toggle): after each turn above the threshold asks to run `/compact`; while it runs, shows an
// ESTIMATED progress (the SDK only reports start and end of a compaction). Also shows the CLI's own auto-compact.
export function AutoCompactModal({ sessionId, chat, enabled, onCompact, onDecline }: { sessionId: string; chat: Chat; enabled: boolean; onCompact: () => void; onDecline: (percentage: number) => void }) {
  const [run, setRun] = useState<{ seq: number; at: number } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [, rerender] = useState(0);
  const ctx = chat.context;
  const cmp = chat.compact;
  const busy = chat.state === 'running' || chat.state === 'awaiting_permission';

  // the request ended: a compaction result, the turn's closing context.usage, or the process exited
  const finished = !!run && ((!!cmp && cmp.seq > run.seq && cmp.phase !== 'running') || (!!ctx && ctx.seq > run.seq) || chat.state === 'exited');
  const failed = finished && cmp && cmp.seq > run!.seq && cmp.phase === 'failed';
  const external = !run && cmp?.phase === 'running' && !hidden; // compaction started by the CLI mid-turn
  const running = (!!run && !finished) || external;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => { if (cmp?.phase !== 'running') setHidden(false); }, [cmp?.phase]);
  useEffect(() => {
    if (!finished || failed) return;
    const t = setTimeout(() => setRun(null), 1500); // show 100% briefly, then close
    return () => clearTimeout(t);
  }, [finished, failed]);

  const ask = enabled && !run && !busy && !external && !!ctx && ctx.percentage >= COMPACT_THRESHOLD && ctx.seq > (handled.get(sessionId) ?? 0);
  if (!ask && !run && !external) return null;

  const answer = (yes: boolean) => {
    handled.set(sessionId, ctx!.seq);
    if (yes) { setRun({ seq: chat.lastSeq, at: Date.now() }); onCompact(); } else { onDecline(ctx!.percentage); rerender((n) => n + 1); }
  };

  // asymptotic estimate, time constant scaled by context size (~30 s for 120k tokens)
  const startedAt = run?.at ?? cmp?.startedAt ?? now;
  const tau = Math.max(10_000, ((ctx?.totalTokens ?? 100_000) / 1000) * 250);
  const pct = finished ? 100 : Math.min(95, Math.round(95 * (1 - Math.exp(-(now - startedAt) / tau))));
  const tokens = cmp?.preTokens !== undefined && cmp.postTokens !== undefined ? `${fmtTokens(cmp.preTokens)} → ${fmtTokens(cmp.postTokens)} tokens` : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-left font-sans">
      <div className="w-[26rem] max-w-full rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]">
        {ask && !run ? (
          <>
            <h2 className="text-sm font-semibold text-zinc-100">Compactar a sessão?</h2>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              O contexto está em <span className="font-mono text-zinc-100">{Math.round(ctx!.percentage)}%</span> ({fmtTokens(ctx!.totalTokens)} de {fmtTokens(ctx!.maxTokens)} tokens).
              Cada mensagem relê todo esse contexto: compactar agora economiza tokens e evita perda de qualidade em contextos longos.
            </p>
            <div className="mt-4 flex justify-end gap-1.5">
              <button className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200" onClick={() => answer(false)}>Cancelar</button>
              <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200" onClick={() => answer(true)}>Compactar</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {running && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-100" />}
              <h2 className="text-sm font-semibold text-zinc-100">{failed ? 'Falha ao compactar' : finished ? 'Sessão compactada' : 'Compactando a sessão…'}</h2>
              <span className="flex-1" />
              <span className="font-mono text-xs text-zinc-300">{pct}%</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full rounded-full transition-[width] duration-300 ${failed ? 'bg-rose-400' : 'bg-zinc-100'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 text-[11px] text-zinc-500">
              {failed ? (cmp?.message ?? 'Erro desconhecido.') : finished ? (tokens ?? 'Concluído.') : 'Progresso estimado: o Claude Code só informa início e fim da compactação.'}
            </div>
            {(failed || external) && (
              <div className="mt-3 flex justify-end">
                <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={() => (failed ? setRun(null) : setHidden(true))}>{failed ? 'Fechar' : 'Ocultar'}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
