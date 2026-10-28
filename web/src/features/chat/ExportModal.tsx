import { useState } from 'react';
import { api } from '../../api';
import { Modal, primary } from '../../lib/Modal';

// full-overview export of one session (NDJSON for another AI): Claude Code transcript + what the Deck did, see docs/architecture.md
export function ExportModal({ projectId, sessionId, onClose }: { projectId: string; sessionId: string; onClose: () => void }) {
  const [redact, setRedact] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

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
    <Modal
      size="sm" onClose={onClose} title="Exportar panorama da sessão"
      footer={<button className={primary} disabled={busy} onClick={() => void download()}>{busy ? 'Gerando…' : 'Baixar'}</button>}
    >
      <p className="text-sm leading-relaxed text-zinc-400">
        Gera um arquivo .jsonl com tudo desta sessão (conversa, ferramentas, skills, subagentes, hooks e o que o Claude Deck fez) e totais de tokens por origem, para uma IA analisar onde dá para economizar. A conversa vem do transcript do Claude Code, que ele apaga após 30 dias por padrão.
      </p>
      <label className="mt-4 flex items-center gap-2.5 text-sm text-zinc-200">
        <input type="checkbox" className="h-4 w-4" checked={redact} onChange={(e) => setRedact(e.target.checked)} /> Mascarar segredos (chaves, tokens, senhas)
      </label>
      <p className="mt-1.5 text-xs text-zinc-500">A máscara cobre padrões conhecidos; não é garantia. Revise o arquivo antes de enviá-lo a terceiros.</p>
      {err && <div className="mt-3 text-sm text-rose-300">{err}</div>}
      {done && <div className="mt-3 break-all text-sm text-emerald-300">Baixado: {done}</div>}
    </Modal>
  );
}
