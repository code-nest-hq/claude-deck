import { useEffect } from 'react';
import { EFFORTS, MODELS, type Effort, type Model } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';
import { Modal, field, primary } from '../../lib/Modal';

export function Toggle({ on, label, desc, tone = 'zinc', onClick }: { on: boolean; label: string; desc: string; tone?: 'zinc' | 'rose'; onClick: () => void }) {
  const dot = on ? (tone === 'rose' ? 'bg-rose-400' : 'bg-zinc-100') : 'bg-zinc-600';
  return (
    <button className="flex w-full items-start justify-between gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3 text-left transition-colors hover:border-zinc-700" onClick={onClick}>
      <div>
        <div className="text-sm font-medium text-zinc-200">{label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{desc}</div>
      </div>
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border border-zinc-700 p-0.5 transition-colors ${on ? (tone === 'rose' ? 'bg-rose-500/20' : 'bg-zinc-700') : 'bg-zinc-900'}`}>
        <span className={`h-3.5 w-3.5 rounded-full transition-transform ${dot} ${on ? 'translate-x-4' : ''}`} />
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
    <Modal
      size="md" onClose={onClose} title={p.name}
      subtitle={<span className="block font-mono text-xs"><span className="block truncate">{p.path}</span><span className="block">{conn?.kind === 'ssh' ? `remote · ${conn.label}` : 'local'}</span></span>}
      footer={<>
        <button className="mr-auto text-sm text-zinc-500 transition-colors hover:text-rose-400" onClick={async () => { if (confirm(`Remove "${p.name}" from the list? (does not delete Claude sessions)`)) { await api.delProject(p.id); await reloadProjects(); onClose(); } }}>Remove project</button>
        <button className={primary} onClick={onClose}>Done</button>
      </>}
    >
        <div className="space-y-2">
          <Toggle
            on={p.lean} label="Lean" onClick={() => patch({ lean: !p.lean })}
            desc="Skips your hooks, plugins, skills, MCP and CLAUDE.md. About 80% cheaper to start a session."
          />
          <Toggle
            on={!!p.routing} label="Model Routing" onClick={() => patch({ routing: !p.routing })}
            desc="Picks Haiku or Sonnet per message to save tokens, escalating when the task needs more reasoning."
          />
          <Toggle
            on={!!p.autoCompact} label="Auto-compact" onClick={() => patch({ autoCompact: !p.autoCompact })}
            desc="After a reply, if context passes 60% or 150k tokens, asks whether to run /compact. Also asks before sending after a 5+ min pause on a big context (cold cache)."
          />
          <Toggle
            on={!!p.bypass} tone="rose" label="Bypass permissions" onClick={() => { if (p.bypass || confirm(`Turn on permission bypass for "${p.name}"? Claude Code will be able to run commands and edit files without asking.`)) void patch({ bypass: !p.bypass }); }}
            desc="Claude Code runs Bash and edits without asking in this project. Use with care."
          />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-zinc-400">Default model
            <select className={`${field} mt-1.5 font-normal`} value={p.model ?? ''} onChange={(e) => void patch({ model: (e.target.value || undefined) as Model | undefined })}>
              <option value="">(global default)</option>
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-400">Default effort
            <select className={`${field} mt-1.5 font-normal`} value={p.effort ?? ''} onChange={(e) => void patch({ effort: (e.target.value || undefined) as Effort | undefined })}>
              <option value="">(global default)</option>
              {EFFORTS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-6">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider font-medium uppercase tracking-wider text-zinc-500">Project skills and plugins</div>
          {skills.length === 0
            ? <div className="text-xs text-zinc-600">No skills or plugins loaded (or Lean is on).</div>
            : (
              <ul className="space-y-1.5">
                {skills.map((s) => (
                  <li key={s.name} className="flex items-baseline gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
                    <span className="shrink-0 font-mono text-xs text-zinc-100">/{s.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{s.description}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>

    </Modal>
  );
}
