import { useEffect, useState } from 'react';
import type { Config, Project, SessionStatus } from '@ccui/shared';
import { api } from '../../api';
import { fmtTokens } from '../../lib/format';
import type { Chat } from './reduce';

const MODEL_LABEL = { haiku: 'Haiku', sonnet: 'Sonnet 5' } as const;
const fmtDate = (ms: number) => new Date(ms).toLocaleString('pt-BR');

// read-only snapshot of one session, like the terminal's `/status` (never compacts or changes anything)
export function StatusModal({ sessionId, name, project, config, chat, onClose }: { sessionId: string; name: string; project: Project; config: Config | null; chat: Chat; onClose: () => void }) {
  const [st, setSt] = useState<SessionStatus | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.sessionStatus(project.id, sessionId).then(setSt, (e: Error) => setErr(e.message)); }, [project.id, sessionId]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

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
    ['Contexto', chat.context ? `${chat.context.percentage.toFixed(0)}% · ${fmtTokens(chat.context.totalTokens)} / ${fmtTokens(chat.context.maxTokens)}` : '— (após o próximo turno)'],
    ['Tokens', `${fmtTokens(t.input + t.output)} (entrada ${fmtTokens(t.input)} · saída ${fmtTokens(t.output)} · cache leitura ${fmtTokens(t.cacheRead)})`],
    ['Custo estimado', `$${t.costUsd.toFixed(4)}`],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-left font-sans" onClick={onClose}>
      <div className="max-h-[80vh] w-[36rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">Status da sessão</h2>
          <span className="flex-1" />
          <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        {err && <div className="mt-2 text-xs text-rose-300">{err}</div>}
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="min-w-0 break-all text-zinc-300">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
