import { useEffect } from 'react';
import { fmtTokens } from '../../lib/format';
import type { Chat } from './reduce';

const n = (v: number) => v.toLocaleString('pt-BR');

// per-category token breakdown of one session (session total + last turn); read-only
export function UsageModal({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const t = chat.totals;
  const l = chat.lastTokens;
  const rows: Array<[string, string, number, number | undefined]> = [
    ['Entrada', 'tokens novos enviados ao modelo', t.input, l?.input],
    ['Saída', 'resposta do modelo (inclui thinking)', t.output, l?.output],
    ['Cache — escrita', 'contexto gravado no cache (system prompt, CLAUDE.md, plugins, histórico)', t.cacheCreation, l?.cacheCreation],
    ['Cache — leitura', 'contexto reaproveitado do cache a cada turno', t.cacheRead, l?.cacheRead],
  ];
  const total = t.input + t.output + t.cacheCreation + t.cacheRead;
  const lastTotal = l ? l.input + l.output + l.cacheCreation + l.cacheRead : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-left font-sans" onClick={onClose}>
      <div className="max-h-[80vh] w-[36rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">Consumo da sessão</h2>
          <span className="flex-1" />
          <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="pb-1.5 font-normal" />
              <th className="pb-1.5 text-right font-normal">Sessão</th>
              <th className="pb-1.5 text-right font-normal">Último turno</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {rows.map(([label, hint, sess, last]) => (
              <tr key={label} className="border-t border-zinc-800/60 align-top">
                <td className="py-1.5 pr-3"><div>{label}</div><div className="text-zinc-500">{hint}</div></td>
                <td className="py-1.5 text-right font-mono" title={n(sess)}>{fmtTokens(sess)}</td>
                <td className="py-1.5 text-right font-mono">{last === undefined ? '—' : fmtTokens(last)}</td>
              </tr>
            ))}
            <tr className="border-t border-zinc-700 font-medium text-zinc-100">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 text-right font-mono" title={n(total)}>{fmtTokens(total)}</td>
              <td className="py-1.5 text-right font-mono">{lastTotal === undefined ? '—' : fmtTokens(lastTotal)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 text-xs text-zinc-400">Custo estimado: <span className="font-mono text-zinc-200">${t.costUsd.toFixed(4)}</span></div>
        <p className="mt-1 text-xs text-zinc-500">Custo a preço de API; em plano de assinatura não é uma cobrança. Passe o mouse num valor para ver o número exato.</p>
      </div>
    </div>
  );
}
