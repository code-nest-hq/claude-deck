import { useEffect, useState } from 'react';
import { baselineAdvice, type Config, type Project, type SessionStatus } from '@ccui/shared';
import { api } from '../../api';
import { fmtTokens } from '../../lib/format';
import { Modal } from '../../lib/Modal';
import { contextZone } from './AutoCompactModal';
import { contextAdvice, usedMcpServers } from './contextAdvice';
import type { Chat } from './reduce';

const MODEL_LABEL = { haiku: 'Haiku', sonnet: 'Sonnet 5' } as const;
const fmtDate = (ms: number) => new Date(ms).toLocaleString('pt-BR');

// read-only snapshot of one session, like the terminal's `/status` (never compacts or changes anything)
export function StatusModal({ sessionId, name, project, config, chat, onClose }: { sessionId: string; name: string; project: Project; config: Config | null; chat: Chat; onClose: () => void }) {
  const [st, setSt] = useState<SessionStatus | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.sessionStatus(project.id, sessionId).then(setSt, (e: Error) => setErr(e.message)); }, [project.id, sessionId]);

  const conn = config?.connections.find((c) => c.id === project.connectionId);
  const profileId = config?.activeProfile ?? 'default';
  const profile = profileId === 'default' ? 'default (~/.claude)' : config?.profiles?.find((p) => p.id === profileId)?.name ?? profileId;
  const lastRouted = chat.items.findLast((it) => it.kind === 'user' && it.routedModel);
  const t = chat.totals;
  const rows: Array<[string, React.ReactNode]> = [
    ['Session ID', (
      <button className="font-mono text-zinc-200 hover:text-white" title="Copiar" onClick={() => { void navigator.clipboard?.writeText(sessionId).then(() => setCopied(true), () => {}); }}>
        {sessionId} <span className="text-zinc-500">{copied ? '✓' : '⧉'}</span>
      </button>
    )],
    ['Nome', name],
    ['Projeto', project.name],
    ['Path', <span className="font-mono">{project.path}</span>],
    ['Conexão', conn ? (conn.kind === 'ssh' ? `${conn.label} (SSH ${conn.target ?? ''})` : `${conn.label} (local)`) : project.connectionId],
    ...(conn?.kind !== 'ssh' ? [['Perfil ativo', profile] as [string, React.ReactNode]] : []),
    ['Estado', `${chat.state}${st ? (st.live ? ' · processo ativo' : ' · sem processo') : ''}`],
  ];
  if (st) rows.push(
    ['Modelo padrão', MODEL_LABEL[st.model]],
    ...(lastRouted?.kind === 'user' && lastRouted.routedModel ? [['Último roteado', MODEL_LABEL[lastRouted.routedModel]] as [string, React.ReactNode]] : []),
    ['Effort', st.effort],
    ['Model Routing', st.routing ? 'ligado' : 'desligado'],
    ['Permissões', st.permissionMode === 'bypassPermissions' ? 'bypass' : st.permissionMode],
    ['Lean', st.lean ? 'sim' : 'não'],
    ['Auto-compact', project.autoCompact ? 'ligado' : 'desligado'],
    ['Criada', fmtDate(st.meta.createdAt)],
    ['Último uso', fmtDate(st.meta.lastUsedAt)],
  );
  rows.push(
    ['Contexto', chat.context ? `${chat.context.percentage.toFixed(0)}% · ${fmtTokens(chat.context.totalTokens)} / ${fmtTokens(chat.context.maxTokens)} · ${contextZone(chat.context, contextAdvice(chat.items, chat.context.totalTokens))}` : '— (após o próximo turno)'],
    ['Tokens', `${fmtTokens(t.input + t.output + t.cacheCreation + t.cacheRead)} (entrada ${fmtTokens(t.input)} · saída ${fmtTokens(t.output)} · cache escrita ${fmtTokens(t.cacheCreation)} · cache leitura ${fmtTokens(t.cacheRead)})`],
    ['Custo estimado', `$${t.costUsd.toFixed(4)}`],
  );

  return (
    <Modal size="md" onClose={onClose} title="Session status" subtitle={name}>
      {err && <div className="mb-3 text-sm text-rose-300">{err}</div>}
      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="min-w-0 break-all text-zinc-200">{v}</dd>
          </div>
        ))}
      </dl>
      {chat.baseline && <Baseline chat={chat} lean={!!st?.lean} />}
    </Modal>
  );
}

// what the session loads before the first message (slide "Sessão limpa"): the part of the context the user can trim
function Baseline({ chat, lean }: { chat: Chat; lean: boolean }) {
  const b = chat.baseline!;
  const tips = baselineAdvice(b, usedMcpServers(chat.items), lean);
  return (
    <section className="mt-5 border-t border-zinc-800/60 pt-4 text-sm">
      <h3 className="mb-2 font-medium text-zinc-300">Carga inicial do contexto <span className="font-mono text-zinc-500">{fmtTokens(b.tokens)}</span></h3>
      <ul className="space-y-1 font-mono text-xs text-zinc-400">
        {b.categories.slice(0, 6).map((c) => <li key={c.name} className="flex justify-between gap-3"><span>{c.name}</span><span>{fmtTokens(c.tokens)}</span></li>)}
      </ul>
      {tips.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs text-amber-300/90">
          {tips.map((t) => <li key={t.id}>• {t.text}</li>)}
        </ul>
      )}
    </section>
  );
}
