import { useMemo, useState } from 'react';
import { buildContextAuditPrompt, type Project } from '@ccui/shared';
import { api } from '../../api';
import { fmtTokens } from '../../lib/format';
import { useApp } from '../../store';
import { Modal, ghost, primary } from '../../lib/Modal';
import { usedMcpServers } from './contextAdvice';
import type { Chat } from './reduce';

// "Analisar contexto": opens a new session in plan mode (read-only until the plan is approved) that reviews what can be
// trimmed from CLAUDE.md, MCPs, skills and plugins. The default prompt carries the numbers measured in this session.
export function ContextAuditModal({ project, sessionId, chat, onClose }: { project: Project; sessionId: string; chat: Chat; onClose: () => void }) {
  const { open, refreshRows, send } = useApp();
  const [extra, setExtra] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const text = useMemo(() => buildContextAuditPrompt(chat.baseline, usedMcpServers(chat.items), extra), [chat.baseline, chat.items, extra]);
  const blocked = project.lean ? 'O projeto está em modo Lean: a nova sessão não carregaria CLAUDE.md, skills nem MCPs, então não teria o que analisar. Desligue o Lean nas configurações do projeto.'
    : project.bypass ? 'O projeto está em bypass de permissões: o modo plano não está disponível e a análise não ficaria somente leitura.' : '';

  const start = async () => {
    setCreating(true); setErr('');
    try {
      const st = await api.sessionStatus(project.id, sessionId);
      const s = await api.newSession(project.id, { name: 'Análise de contexto', model: 'sonnet', effort: st.effort, routing: false });
      await api.setPlan(project.id, s.sessionId, true);
      await refreshRows(project.id);
      open(project.id, s.sessionId);
      send(text, false);
      onClose();
    } catch (e) { setErr((e as Error).message); setCreating(false); }
  };

  return (
    <Modal
      size="lg" onClose={onClose} title="Analisar contexto"
      subtitle="Abre uma sessão nova em modo plano (somente leitura até você aprovar) que propõe o que enxugar no CLAUDE.md e quais MCPs, skills e plugins desativar. A sessão atual continua intacta."
      footer={<>
        <button className={ghost} onClick={onClose}>Cancelar</button>
        <button className={primary} disabled={creating || !!blocked} onClick={() => void start()}>{creating ? 'Criando…' : 'Iniciar análise'}</button>
      </>}
    >
      {blocked && <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{blocked}</div>}
      <input
        className="mb-4 w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-600"
        placeholder='Detalhes extras (opcional), ex.: "não mexa na seção de segurança" ou "foque nos MCPs"' value={extra} maxLength={500} disabled={creating} onChange={(e) => setExtra(e.target.value)}
      />
      <textarea
        className="h-72 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs leading-relaxed text-zinc-200 outline-none"
        value={text} readOnly
      />
      <div className="mt-2 text-xs text-zinc-500">≈ {fmtTokens(Math.ceil(text.length / 4))} tokens{chat.baseline ? '' : ' · sem medição: envie uma mensagem antes para o prompt incluir os números reais'}</div>
      {err && <div className="mt-3 text-sm text-rose-300">{err}</div>}
    </Modal>
  );
}
