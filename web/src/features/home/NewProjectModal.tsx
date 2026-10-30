import { useState } from 'react';
import type { Project } from '@ccui/shared';
import { api } from '../../api';
import { PROJECT_COLORS } from '../../lib/projectColor';
import { useApp } from '../../store';
import { FolderBrowserModal } from '../projects/FolderBrowserModal';
import { field, ghost, label, primary } from '../../lib/Modal';
import { Toggle } from '../projects/ProjectSettingsModal';

function Shell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="layer w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]" style={{ '--layer-from': '0px' } as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Setup({ project, onDone }: { project: Project; onDone: () => void }) {
  const { projects, reloadProjects, notifyOn, toggleNotify } = useApp();
  const p = projects.find((x) => x.id === project.id) ?? project;
  const patch = async (b: Parameters<typeof api.patchProject>[1]) => { await api.patchProject(p.id, b); await reloadProjects(); };
  return (
    <Shell onClose={onDone}>
      <h2 className="text-lg font-semibold tracking-tight text-zinc-100">Set up “{p.name}”</h2>
      <p className="mb-4 mt-1 text-sm text-zinc-500">Choose what this project should use. You can change all of this later in project settings.</p>
      <div className="space-y-2">
        <Toggle on={!!p.routing} label="Model Routing" desc="Picks Haiku or Sonnet per message to save tokens, escalating when the task needs more reasoning." onClick={() => patch({ routing: !p.routing })} />
        <Toggle on={p.lean} label="Lean" desc="Skips your hooks, plugins, skills, MCP and CLAUDE.md. About 80% cheaper to start a session." onClick={() => patch({ lean: !p.lean })} />
        <Toggle on={!!p.autoCompact} label="Auto-compact" desc="After a reply, if context passes 60% or 100k tokens, asks whether to run /compact. Also asks before sending after a 5+ min pause on a big context (cold cache)." onClick={() => patch({ autoCompact: !p.autoCompact })} />
        <Toggle on={notifyOn} label="Notifications" desc="Browser alert when a background session finishes or needs permission." onClick={() => void toggleNotify()} />
        <Toggle
          on={!!p.bypass} tone="rose" label="Bypass permissions"
          desc="Claude Code runs Bash and edits without asking in this project. Use with care."
          onClick={() => { if (p.bypass || confirm(`Turn on permission bypass for "${p.name}"? Claude Code will be able to run commands and edit files without asking.`)) void patch({ bypass: !p.bypass }); }}
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className={ghost} onClick={onDone}>Skip</button>
        <button className={primary} onClick={onDone}>Open project</button>
      </div>
    </Shell>
  );
}

export function NewProjectModal({ connectionId, onClose }: { connectionId: string; onClose: () => void }) {
  const { config, reloadProjects, go } = useApp();
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<Project | null>(null);
  const conn = config?.connections.find((c) => c.id === connectionId);

  if (created) return <Setup project={created} onDone={() => { onClose(); go({ name: 'project', projectId: created.id }); }} />;

  const setFolder = (p: string) => { setPath(p); if (!name.trim()) setName(p.split('/').filter(Boolean).at(-1) ?? ''); };
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const p = await api.addProject({ name: name.trim(), path: path.trim(), lean: false, connectionId, color });
      await reloadProjects();
      setCreated(p);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <Shell onClose={onClose}>
      <h2 className="text-lg font-semibold tracking-tight text-zinc-100">New project</h2>
      <p className="mb-5 mt-1 text-sm text-zinc-500">{conn?.kind === 'ssh' ? `Folder on ${conn.label}.` : 'Point to a folder on this machine.'}</p>
      <label className={label} htmlFor="np-path">Folder</label>
      <div className="mb-4 flex gap-2">
        <input id="np-path" autoFocus className={`${field} font-mono text-xs`} placeholder="/absolute/path/to/project" value={path} onChange={(e) => setFolder(e.target.value)} />
        <button className="shrink-0 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900" onClick={() => setBrowsing(true)}>Browse</button>
      </div>
      <label className={label} htmlFor="np-name">Name</label>
      <input id="np-name" className={`${field} mb-4`} placeholder="my-project" value={name} onChange={(e) => setName(e.target.value)} />
      <span className={label}>Color</span>
      <div className="mb-2 flex gap-2.5" role="radiogroup" aria-label="Project color">
        {PROJECT_COLORS.map((c) => (
          <button key={c} role="radio" aria-checked={c === color} aria-label={c} className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${c === color ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-950' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      {err && <div className="mt-3 text-sm text-rose-400">{err}</div>}
      <div className="mt-6 flex justify-end gap-2">
        <button className={ghost} onClick={onClose}>Cancel</button>
        <button className={primary} disabled={busy || !path.trim() || !name.trim()} onClick={create}>{busy ? 'Creating…' : 'Create project'}</button>
      </div>
      {browsing && <FolderBrowserModal connectionId={connectionId} onPick={(p) => { setFolder(p); setBrowsing(false); }} onClose={() => setBrowsing(false)} />}
    </Shell>
  );
}
