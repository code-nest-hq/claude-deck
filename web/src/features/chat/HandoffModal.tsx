import { useEffect, useState } from 'react';
import type { SessionStatus } from '@ccui/shared';
import { api } from '../../api';
import { fmtTokens } from '../../lib/format';
import { useApp } from '../../store';

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
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-left font-sans" onClick={onClose}>
      <div className="flex max-h-[85vh] w-[40rem] max-w-full flex-col rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">Nova sessão com handoff</h2>
          <span className="flex-1" />
          <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Abre uma sessão limpa (mesmo projeto, modelo e effort) já com o contexto do que foi feito, sem carregar o histórico inteiro. A sessão atual continua intacta.
        </p>
        <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={enrich} disabled={loading || creating} onChange={(e) => setEnrich(e.target.checked)} /> Enriquecer com Haiku (decisões e pendências)
        </label>
        <textarea
          className="mt-3 min-h-[16rem] flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-[11px] leading-relaxed text-zinc-200 outline-none focus:border-zinc-700 disabled:opacity-50"
          value={loading ? 'Gerando handoff…' : text} disabled={loading || creating} onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-1 text-[11px] text-zinc-500">≈ {fmtTokens(Math.ceil(text.length / 4))} tokens{note && ` · ${note}`}</div>
        {err && <div className="mt-2 text-xs text-rose-300">{err}</div>}
        <div className="mt-3 flex justify-end gap-1.5">
          <button className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200" onClick={onClose}>Cancelar</button>
          <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50" disabled={loading || creating || !text.trim()} onClick={() => void create()}>{creating ? 'Criando…' : 'Iniciar sessão'}</button>
        </div>
      </div>
    </div>
  );
}
