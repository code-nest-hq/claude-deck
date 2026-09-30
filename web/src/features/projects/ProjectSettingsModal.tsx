import { useEffect } from 'react';
import { EFFORTS, MODELS, type Effort, type Model } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';

function Toggle({ on, label, desc, tone = 'zinc', onClick }: { on: boolean; label: string; desc: string; tone?: 'zinc' | 'rose'; onClick: () => void }) {
  const dot = on ? (tone === 'rose' ? 'bg-rose-400' : 'bg-zinc-100') : 'bg-zinc-600';
  return (
    <button className="flex w-full items-start justify-between gap-3 rounded-md border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5 text-left transition-colors hover:border-zinc-700" onClick={onClick}>
      <div>
        <div className="text-xs font-medium text-zinc-200">{label}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{desc}</div>
      </div>
      <span className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full border border-zinc-700 p-0.5 transition-colors ${on ? (tone === 'rose' ? 'bg-rose-500/20' : 'bg-zinc-700') : 'bg-zinc-900'}`}>
        <span className={`h-2.5 w-2.5 rounded-full transition-transform ${dot} ${on ? 'translate-x-3' : ''}`} />
      </span>
    </button>
  );
}

// Configurações do projeto: caminho/conexão, toggles (lean/routing/auto-compact/bypass), modelo/effort default e skills disponíveis.
// Substitui os antigos botões lean/rota/bypass na própria linha do projeto (que sobrepunham o nome no hover).
export function ProjectSettingsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { projects, config, reloadProjects, commands, ensureCommands } = useApp();
  const p = projects.find((x) => x.id === projectId);
  const conn = config?.connections.find((c) => c.id === p?.connectionId);
  const skills = (commands[`${projectId}:${p?.lean ?? false}`] ?? []).filter((c) => !c.builtin);

  useEffect(() => { void ensureCommands(projectId); }, [projectId, ensureCommands]);

  if (!p) return null;
  const patch = async (b: Partial<Pick<typeof p, 'lean' | 'routing' | 'bypass' | 'autoCompact' | 'model' | 'effort'>>) => { await api.patchProject(p.id, b); await reloadProjects(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-zinc-100">{p.name}</h2>
          <div className="mt-1 space-y-0.5 font-mono text-[11px] text-zinc-500">
            <div className="truncate">{p.path}</div>
            <div>{conn?.kind === 'ssh' ? `remoto · ${conn.label}` : 'local'}</div>
          </div>
        </div>

        <div className="space-y-2">
          <Toggle
            on={p.lean} label="Lean" onClick={() => patch({ lean: !p.lean })}
            desc="Ignora hooks/plugins/skills/MCP/CLAUDE.md do usuário. ~80% mais barato ao iniciar a sessão."
          />
          <Toggle
            on={!!p.routing} label="Model Routing" onClick={() => patch({ routing: !p.routing })}
            desc="Escolhe Haiku ou Sonnet por mensagem pra economizar tokens, com escalação automática se a tarefa precisar de mais raciocínio."
          />
          <Toggle
            on={!!p.autoCompact} label="Auto-compactar" onClick={() => patch({ autoCompact: !p.autoCompact })}
            desc="Após cada resposta, se o contexto passar de 60%, pergunta se quer rodar /compact pra economizar tokens."
          />
          <Toggle
            on={!!p.bypass} tone="rose" label="Bypass de permissões" onClick={() => { if (p.bypass || confirm(`Ligar bypass de permissões em "${p.name}"? Claude Code vai poder rodar comandos e editar arquivos sem pedir aprovação.`)) void patch({ bypass: !p.bypass }); }}
            desc="Claude Code roda Bash/edições sem pedir aprovação neste projeto. Use com cuidado."
          />
        </div>

        <div className="mt-4 flex gap-3">
          <label className="flex-1 text-xs text-zinc-400">Modelo padrão
            <select className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700" value={p.model ?? ''} onChange={(e) => void patch({ model: (e.target.value || undefined) as Model | undefined })}>
              <option value="">(padrão global)</option>
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex-1 text-xs text-zinc-400">Effort padrão
            <select className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700" value={p.effort ?? ''} onChange={(e) => void patch({ effort: (e.target.value || undefined) as Effort | undefined })}>
              <option value="">(padrão global)</option>
              {EFFORTS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">Skills e plugins do projeto</div>
          {skills.length === 0
            ? <div className="text-xs text-zinc-600">Nenhuma skill/plugin carregado (ou modo lean está ativo).</div>
            : (
              <ul className="space-y-1">
                {skills.map((s) => (
                  <li key={s.name} className="flex items-baseline gap-2 rounded-md border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-1.5">
                    <span className="shrink-0 font-mono text-xs text-zinc-100">/{s.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{s.description}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-zinc-800/70 pt-3">
          <button
            className="text-xs font-medium text-zinc-500 transition-colors hover:text-rose-400"
            onClick={async () => { if (confirm(`Remover "${p.name}" da lista? (não apaga sessões do Claude)`)) { await api.delProject(p.id); await reloadProjects(); onClose(); } }}
          >Remover projeto</button>
          <button className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
