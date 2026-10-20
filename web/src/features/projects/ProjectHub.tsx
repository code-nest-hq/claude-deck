import { useEffect, useState } from 'react';
import { api } from '../../api';
import { IconPlug, IconPlus, IconSearch, IconSettings } from '../../lib/icons';
import { projectColor } from '../../lib/projectColor';
import { useApp } from '../../store';
import { PluginsModal } from '../chat/PluginsModal';
import { jumpToLine, SearchModal } from '../chat/SearchModal';
import { barBtnPrimary, TopBar } from '../home/TopBar';
import { SessionRowItem } from '../sessions/SessionRowItem';
import { ProjectSettingsModal } from './ProjectSettingsModal';

function Tool({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button className="flex items-center gap-3.5 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/60" onClick={onClick}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-100">{title}</span>
        <span className="block truncate text-xs text-zinc-500">{hint}</span>
      </span>
    </button>
  );
}

export function ProjectHub({ projectId }: { projectId: string }) {
  const { projects, rows, go, setUi } = useApp();
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const p = projects.find((x) => x.id === projectId);
  useEffect(() => { if (!p) go({ name: 'home' }); }, [p, go]);
  if (!p) return null;
  const list = (rows[p.id] ?? []).filter((r) => !r.archived).sort((a, b) => b.lastModified - a.lastModified);
  const flags = [p.routing && 'Model Routing', p.lean && 'Lean', p.autoCompact && 'Auto-compact', p.bypass && 'Bypass'].filter(Boolean).join(' · ');
  return (
    <div className="flex h-screen flex-col" style={{ '--c': projectColor(p) } as React.CSSProperties}>
      <TopBar back="Projects" crumb={p.name}>
        <button className={barBtnPrimary} onClick={() => setUi({ newSession: true, newFor: p.id })}><IconPlus className="h-3.5 w-3.5" /> New session</button>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-zinc-100">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--c)' }} />{p.name}
        </h1>
        <p className="mb-8 mt-1 truncate font-mono text-xs text-zinc-600">{p.path}{flags && <span className="font-sans text-zinc-500"> · {flags}</span>}</p>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section>
            <h2 className="mb-3 text-sm font-medium text-zinc-300">Project tools</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Tool icon={<IconPlug className="h-4 w-4" />} title="Plugins" hint="Install, enable, update, marketplaces" onClick={() => setPluginsOpen(true)} />
              <Tool icon={<IconSearch className="h-4 w-4" />} title="Search" hint="Across every session" onClick={() => { void api.search(p.id, '').catch(() => {}); setUi({ searchFor: p.id }); }} />
              <Tool icon={<IconSettings className="h-4 w-4" />} title="Settings" hint="Bypass, routing, lean, models" onClick={() => setUi({ settingsFor: p.id })} />
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-zinc-300">Sessions</h2>
              <button className="text-xs text-zinc-500 transition-colors hover:text-zinc-100" onClick={() => go({ name: 'sessions', projectId: p.id })}>All sessions &amp; archive →</button>
            </div>
            <ul className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
              {list.length === 0 && <li className="px-4 py-6 text-sm text-zinc-600">No sessions yet. Start one with “New session”.</li>}
              {list.slice(0, 5).map((r) => <SessionRowItem key={r.sessionId} r={r} projectId={p.id} compact />)}
            </ul>
          </section>
        </div>
      </div>
      {pluginsOpen && <PluginsModal projectId={p.id} onClose={() => setPluginsOpen(false)} />}
    </div>
  );
}

// project-scoped modals that can be opened from any level (hub tools, command palette)
export function ProjectModals() {
  const { ui, setUi } = useApp();
  return (
    <>
      {ui.searchFor && (
        <SearchModal
          placeholder="Search every session in this project…"
          search={async (q) => (await api.search(ui.searchFor!, q)).hits.map((h, i) => ({
            key: `${h.sessionId}:${i}`, label: h.role === 'user' ? 'you' : 'claude', session: h.name, pre: h.pre, match: h.match, post: h.post,
            go: () => jumpToLine(ui.searchFor!, h.sessionId, h.line, h.match, h.nth),
          }))}
          onClose={() => setUi({ searchFor: null })}
        />
      )}
      {ui.settingsFor && <ProjectSettingsModal projectId={ui.settingsFor} onClose={() => setUi({ settingsFor: null })} />}
    </>
  );
}
