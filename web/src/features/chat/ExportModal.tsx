import { useEffect, useState } from 'react';
import { api } from '../../api';

// full-overview export of one session (NDJSON for another AI): Claude Code transcript + what the Deck did, see docs/architecture.md
export function ExportModal({ projectId, sessionId, onClose }: { projectId: string; sessionId: string; onClose: () => void }) {
  const [redact, setRedact] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const download = async () => {
    setBusy(true); setErr(''); setDone('');
    try {
      const { blob, filename } = await api.exportSession(projectId, sessionId, redact);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setDone(`${filename} · ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-left font-sans" onClick={onClose}>
      <div className="w-[30rem] max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">Exportar panorama da sessão</h2>
          <span className="flex-1" />
          <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Gera um arquivo .jsonl com tudo desta sessão (conversa, ferramentas, skills, subagentes, hooks e o que o Claude Deck fez) e totais de tokens por origem, para uma IA analisar onde dá para economizar. A conversa vem do transcript do Claude Code, que ele apaga após 30 dias por padrão.
        </p>
        <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} /> Mascarar segredos (chaves, tokens, senhas)
        </label>
        <p className="mt-1 text-[11px] text-zinc-500">A máscara cobre padrões conhecidos; não é garantia. Revise o arquivo antes de enviá-lo a terceiros.</p>
        {err && <div className="mt-2 text-xs text-rose-300">{err}</div>}
        {done && <div className="mt-2 break-all text-xs text-emerald-300">Baixado: {done}</div>}
        <div className="mt-3 flex justify-end">
          <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50" disabled={busy} onClick={() => void download()}>{busy ? 'Gerando…' : 'Baixar'}</button>
        </div>
      </div>
    </div>
  );
}
