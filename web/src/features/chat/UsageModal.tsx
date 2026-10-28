import { fmtTokens } from '../../lib/format';
import { Modal } from '../../lib/Modal';
import type { Chat } from './reduce';

const n = (v: number) => v.toLocaleString('pt-BR');

// per-category token breakdown of one session (session total + last turn); read-only
export function UsageModal({ chat, onClose }: { chat: Chat; onClose: () => void }) {
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
    <Modal size="md" onClose={onClose} title="Consumo da sessão">
        <table className="w-full text-sm">
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
                <td className="py-2.5 pr-3"><div>{label}</div><div className="text-zinc-500">{hint}</div></td>
                <td className="py-2.5 text-right font-mono" title={n(sess)}>{fmtTokens(sess)}</td>
                <td className="py-2.5 text-right font-mono">{last === undefined ? '—' : fmtTokens(last)}</td>
              </tr>
            ))}
            <tr className="border-t border-zinc-700 font-medium text-zinc-100">
              <td className="py-2.5">Total</td>
              <td className="py-2.5 text-right font-mono" title={n(total)}>{fmtTokens(total)}</td>
              <td className="py-2.5 text-right font-mono">{lastTotal === undefined ? '—' : fmtTokens(lastTotal)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-4 text-sm text-zinc-400">Custo estimado: <span className="font-mono text-zinc-200">${t.costUsd.toFixed(4)}</span></div>
        <p className="mt-1.5 text-xs text-zinc-500">Custo a preço de API; em plano de assinatura não é uma cobrança. Passe o mouse num valor para ver o número exato.</p>
    </Modal>
  );
}
