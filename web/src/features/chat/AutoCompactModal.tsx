import { useEffect, useState } from 'react';
import { fmtTokens } from '../../lib/format';
import { Modal, ghost, primary } from '../../lib/Modal';
import type { Chat } from './reduce';

// % of the autocompact window. Past ~60% quality starts degrading (context rot) and every turn re-reads the whole
// context, so compacting here is cheaper and the summary is built from a still-complete context (the CLI's own
// auto-compact only fires near the limit).
export const COMPACT_THRESHOLD = 60;
// ...or this many tokens, whichever comes first: on a 1M window 60% is 600k tokens, which sessions never reach
// (the largest context seen in the logs was ~250k), so the percentage alone would never fire there.
export const COMPACT_TOKENS = 150_000;

// The prompt cache lasts 5 min: after a longer pause the next message re-reads the whole context uncached (~12x the
// cached price). Below this size that is cents, not worth interrupting.
export const COLD_CACHE_MS = 5 * 60_000;
export const COLD_CACHE_TOKENS = 50_000;
export const isColdCache = (ctx: Chat['context']) => !!ctx && ctx.totalTokens >= COLD_CACHE_TOKENS && Date.now() - ctx.ts > COLD_CACHE_MS;

// context.usage seq already answered (confirmed or cancelled) per session; survives switching sessions
const handled = new Map<string, number>();

// Auto-compact (project toggle): after each turn above the threshold asks to run `/compact`; while it runs, shows an
// ESTIMATED progress (the SDK only reports start and end of a compaction). Also shows the CLI's own auto-compact.
export function AutoCompactModal({ sessionId, chat, enabled, onCompact, onDecline, onHandoff }: { sessionId: string; chat: Chat; enabled: boolean; onCompact: () => void; onDecline: (percentage: number) => void; onHandoff: () => void }) {
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

  const ask = enabled && !run && !busy && !external && !!ctx && (ctx.percentage >= COMPACT_THRESHOLD || ctx.totalTokens >= COMPACT_TOKENS) && ctx.seq > (handled.get(sessionId) ?? 0);
  if (!ask && !run && !external) return null;

  const answer = (yes: boolean) => {
    handled.set(sessionId, ctx!.seq);
    if (yes) { setRun({ seq: chat.lastSeq, at: Date.now() }); onCompact(); } else { onDecline(ctx!.percentage); rerender((n) => n + 1); }
  };

  // "new session with handoff" instead of compacting: counts as answered, so the prompt doesn't come back this turn
  const handoff = () => { handled.set(sessionId, ctx!.seq); rerender((n) => n + 1); onHandoff(); };

  // asymptotic estimate, time constant scaled by context size (~30 s for 120k tokens)
  const startedAt = run?.at ?? cmp?.startedAt ?? now;
  const tau = Math.max(10_000, ((ctx?.totalTokens ?? 100_000) / 1000) * 250);
  const pct = finished ? 100 : Math.min(95, Math.round(95 * (1 - Math.exp(-(now - startedAt) / tau))));
  const tokens = cmp?.preTokens !== undefined && cmp.postTokens !== undefined ? `${fmtTokens(cmp.preTokens)} → ${fmtTokens(cmp.postTokens)} tokens` : undefined;

  if (ask && !run) return (
    <Modal
      size="sm" title="Compactar a sessão?"
      footer={<>
        <button className={ghost} onClick={() => answer(false)}>Cancelar</button>
        <button className={ghost} title="Abre uma sessão limpa com um resumo do que foi feito, sem carregar o histórico" onClick={handoff}>Nova sessão com handoff</button>
        <button className={primary} onClick={() => answer(true)}>Compactar</button>
      </>}
    >
      <p className="text-sm leading-relaxed text-zinc-400">
        O contexto está em <span className="font-mono text-zinc-100">{Math.round(ctx!.percentage)}%</span> ({fmtTokens(ctx!.totalTokens)} de {fmtTokens(ctx!.maxTokens)} tokens).
        Cada mensagem relê todo esse contexto: compactar agora economiza tokens e evita perda de qualidade em contextos longos.
      </p>
    </Modal>
  );

  return (
    <Modal
      size="sm"
      title={<span className="flex items-center gap-2.5">{running && <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-100" />}{failed ? 'Falha ao compactar' : finished ? 'Sessão compactada' : 'Compactando a sessão…'}</span>}
      actions={<span className="mt-1 font-mono text-sm text-zinc-300">{pct}%</span>}
      footer={(failed || external) ? <button className={ghost} onClick={() => (failed ? setRun(null) : setHidden(true))}>{failed ? 'Fechar' : 'Ocultar'}</button> : undefined}
    >
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full transition-[width] duration-300 ${failed ? 'bg-rose-400' : 'bg-zinc-100'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 text-sm text-zinc-500">
        {failed ? (cmp?.message ?? 'Erro desconhecido.') : finished ? (tokens ?? 'Concluído.') : 'Progresso estimado: o Claude Code só informa início e fim da compactação.'}
      </div>
    </Modal>
  );
}

// Auto-compact's second trigger: about to send after the cache went cold. Compacting now costs the same one uncached
// read the message would, but leaves the session with a short context for every later turn.
export function ColdCacheModal({ ctx, onSend, onCompact, onHandoff, onCancel }: { ctx: NonNullable<Chat['context']>; onSend: () => void; onCompact: () => void; onHandoff: () => void; onCancel: () => void }) {
  const mins = Math.round((Date.now() - ctx.ts) / 60_000);
  return (
    <Modal
      size="sm" title="Cache expirado" onClose={onCancel}
      footer={<>
        <button className={ghost} onClick={onSend}>Enviar assim mesmo</button>
        <button className={ghost} title="Abre uma sessão limpa com um resumo do que foi feito, sem carregar o histórico" onClick={onHandoff}>Nova sessão com handoff</button>
        <button className={primary} onClick={onCompact}>Compactar antes</button>
      </>}
    >
      <p className="text-sm leading-relaxed text-zinc-400">
        A sessão está parada há {mins} min, mais que os 5 min do cache. Enviar agora relê os <span className="font-mono text-zinc-100">{fmtTokens(ctx.totalTokens)}</span> tokens do contexto sem cache, a ~12× o preço normal.
        Compactar custa essa mesma leitura, mas deixa as próximas mensagens baratas. Sua mensagem continua no campo de texto.
      </p>
    </Modal>
  );
}
