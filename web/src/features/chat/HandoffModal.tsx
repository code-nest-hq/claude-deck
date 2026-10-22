import { useEffect, useState } from 'react';
import type { SessionStatus } from '@ccui/shared';
import { api } from '../../api';
import { fmtTokens } from '../../lib/format';
import { useApp } from '../../store';
import { Modal, ghost, primary } from '../../lib/Modal';

// "Nova sessão com handoff": the prompt is built locally from the transcript (free); the Haiku checkbox adds a
// distilled decisions/pending section (a few cents at most). The text stays editable before the new session starts.
export function HandoffModal(props: { projectId: string; sessionId: string; name: string; onClose: () => void }) {
  // frozen at mount: opening the new session changes the active one while this modal is still closing
  const [{ projectId, sessionId, name }] = useState(props);
  const { onClose } = props;
  const { open, refreshRows, send } = useApp();
  const [enrich, setEnrich] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true); setErr(''); setNote('');
    api.handoff(projectId, sessionId, enrich).then((r) => {
      if (!live) return;
      setText(r.text);
      if (r.error) setNote(`Haiku falhou (${r.error}); usando só o handoff local.`);
      else if (r.costUsd !== undefined) setNote(`Haiku: US$ ${r.costUsd.toFixed(4)}`);
    }, (e: Error) => live && setErr(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [projectId, sessionId, enrich]);

  const create = async () => {
    setCreating(true); setErr('');
    try {
      const st: SessionStatus = await api.sessionStatus(projectId, sessionId);
      const s = await api.newSession(projectId, { name: `${name} (continuação)`.slice(0, 80), model: st.model, effort: st.effort, routing: st.routing });
      await refreshRows(projectId);
      open(projectId, s.sessionId);
      send(text, false);
      onClose();
    } catch (e) { setErr((e as Error).message); setCreating(false); }
  };

  return (
    <Modal
      size="lg" onClose={onClose} title="Nova sessão com handoff"
      subtitle="Abre uma sessão limpa (mesmo projeto, modelo e effort) já com o contexto do que foi feito, sem carregar o histórico inteiro. A sessão atual continua intacta."
      footer={<>
        <button className={ghost} onClick={onClose}>Cancelar</button>
        <button className={primary} disabled={loading || creating || !text.trim()} onClick={() => void create()}>{creating ? 'Criando…' : 'Iniciar sessão'}</button>
      </>}
    >
      <label className="flex items-center gap-2.5 text-sm text-zinc-200">
        <input type="checkbox" className="h-4 w-4" checked={enrich} disabled={loading || creating} onChange={(e) => setEnrich(e.target.checked)} /> Enriquecer com Haiku (decisões e pendências)
      </label>
      <textarea
        className="mt-4 h-72 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs leading-relaxed text-zinc-200 outline-none transition-colors focus:border-zinc-600 disabled:opacity-50"
        value={loading ? 'Gerando handoff…' : text} disabled={loading || creating} onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 text-xs text-zinc-500">≈ {fmtTokens(Math.ceil(text.length / 4))} tokens{note && ` · ${note}`}</div>
      {err && <div className="mt-3 text-sm text-rose-300">{err}</div>}
    </Modal>
  );
}
