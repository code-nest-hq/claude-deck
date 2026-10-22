import { useCallback, useEffect, useState } from 'react';
import type { PluginAction, PluginsView, PluginView } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';
import { Modal, Tabs, card, field, ghost, secondary } from '../../lib/Modal';

type Tab = 'installed' | 'discover' | 'marketplaces';
type Scope = 'user' | 'project' | 'local';
const MAX_SHOWN = 100;

const btn = secondary;

// "Plugins" header button / `/plugin`: the terminal's plugin manager (`claude plugin …` runs on the project's machine)
export function PluginsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const refreshSession = useApp((s) => s.refreshSession);
  const [view, setView] = useState<PluginsView>();
  const [tab, setTab] = useState<Tab>('installed');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('user');
  const [source, setSource] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setView(await api.plugins(projectId)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (a: PluginAction) => {
    setBusy(true); setMsg(undefined);
    try {
      const r = await api.pluginAction(projectId, a);
      if (r.view) setView(r.view);
      setError(r.error ?? '');
      setMsg({ ok: r.ok, text: r.output || (r.ok ? 'Done.' : 'Failed.') });
      // push the change into the open session (no-op when none is running or a turn is in progress)
      if (r.ok) void refreshSession().catch(() => undefined);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };

  const needle = q.trim().toLowerCase();
  const match = (...f: Array<string | undefined>) => !needle || f.some((x) => x?.toLowerCase().includes(needle));
  const installed = (view?.installed ?? []).filter((p) => match(p.id, p.description));
  const available = (view?.available ?? []).filter((p) => match(p.id, p.description, p.category));
  const sel = view?.installed.find((p) => `${p.id}|${p.scope}|${p.projectPath ?? ''}` === open);
  const switchTab = (t: Tab) => { setTab(t); setOpen(null); };
  const row = `${card} flex items-center gap-3 px-4 py-3`;

  return (
    <Modal
      size="lg" onClose={onClose} title="Plugins"
      subtitle={view ? `${view.installed.length} installed · ${view.installed.filter((p) => p.enabled).length} enabled · ${view.marketplaces.length} marketplaces` : undefined}
      actions={busy ? <span className="mt-1 text-sm text-zinc-500">Working…</span> : <button className={ghost} onClick={() => void load()}>Refresh</button>}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={switchTab} options={[{ id: 'installed', label: 'Installed' }, { id: 'discover', label: 'Discover' }, { id: 'marketplaces', label: 'Marketplaces' }]} />
        <span className="flex-1" />
        {tab !== 'marketplaces' && <input className={`${field} !w-56`} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      {error && <div className="mb-3 whitespace-pre-wrap rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
      {msg && <pre className={`mb-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border px-3 py-2 font-mono text-xs ${msg.ok ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/20 bg-rose-500/10 text-rose-300'}`}>{msg.text}</pre>}
      {!view && !error && <div className="py-10 text-center text-sm text-zinc-500">Loading…</div>}

      {view && tab === 'installed' && (sel ? (
        <Detail p={sel} busy={busy} onBack={() => setOpen(null)} onAction={(kind) => void act({ kind, plugin: sel.id, scope: sel.scope as Scope | undefined })} />
      ) : (
        <div className="space-y-2">
          {installed.length === 0 && <div className="py-10 text-center text-sm text-zinc-500">No plugins installed.</div>}
          {installed.map((p) => (
            <button key={`${p.id}|${p.scope}|${p.projectPath ?? ''}`} className={`${row} w-full text-left hover:border-zinc-700 hover:bg-zinc-900/80`} onClick={() => setOpen(`${p.id}|${p.scope}|${p.projectPath ?? ''}`)}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${p.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} title={p.enabled ? 'enabled' : 'disabled'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-100">{p.name}</span>
                <span className="block truncate text-xs text-zinc-500">{p.marketplace}{p.version ? ` · ${p.version}` : ''}</span>
              </span>
              <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 font-mono text-[11px] text-zinc-400">{p.scope}</span>
            </button>
          ))}
        </div>
      ))}

      {view && tab === 'discover' && (
        <div className="space-y-2">
          <label className="mb-3 flex items-center gap-3 text-sm text-zinc-400">
            Install scope
            <select className={`${field} !w-auto`} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="user">user (all projects)</option>
              <option value="project">project (shared, .claude/settings.json)</option>
              <option value="local">local (this project, private)</option>
            </select>
          </label>
          {available.length === 0 && <div className="py-10 text-center text-sm text-zinc-500">{needle ? 'No match.' : 'Nothing to install: add a marketplace first.'}</div>}
          {available.slice(0, MAX_SHOWN).map((p) => (
            <div key={p.id} className={`${row} items-start`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100">{p.name} <span className="font-normal text-zinc-500">{p.marketplace}{p.category ? ` · ${p.category}` : ''}</span></div>
                {p.description && <div className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-500">{p.description}</div>}
              </div>
              <button className={btn} disabled={busy} onClick={() => void act({ kind: 'install', plugin: p.id, scope })}>Install</button>
            </div>
          ))}
          {available.length > MAX_SHOWN && <div className="pt-2 text-center text-xs text-zinc-500">{available.length - MAX_SHOWN} more: refine the filter.</div>}
        </div>
      )}

      {view && tab === 'marketplaces' && (
        <div className="space-y-2">
          {view.marketplaces.map((m) => (
            <div key={m.name} className={row}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100">{m.name}</div>
                <div className="truncate font-mono text-xs text-zinc-500">{m.source}{m.target ? `: ${m.target}` : ''}</div>
              </div>
              <button className={btn} disabled={busy} onClick={() => void act({ kind: 'marketplace.update', name: m.name })}>Update</button>
              <button className={btn} disabled={busy} onClick={() => { if (confirm(`Remove marketplace ${m.name}? Plugins installed from it are uninstalled.`)) void act({ kind: 'marketplace.remove', name: m.name }); }}>Remove</button>
            </div>
          ))}
          <div className="flex gap-2 pt-3">
            <input className={`${field} min-w-0 flex-1`} placeholder="owner/repo, git URL or path" value={source} onChange={(e) => setSource(e.target.value)} />
            <button className={btn} disabled={busy || !source.trim()} onClick={async () => { await act({ kind: 'marketplace.add', source: source.trim() }); setSource(''); }}>Add marketplace</button>
            <button className={btn} disabled={busy} onClick={() => void act({ kind: 'marketplace.update' })}>Update all</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Detail({ p, busy, onBack, onAction }: { p: PluginView; busy: boolean; onBack: () => void; onAction: (k: 'enable' | 'disable' | 'update' | 'uninstall') => void }) {
  const rows: Array<[string, string]> = [
    ['Status', p.enabled ? 'Enabled' : 'Disabled'],
    ['Scope', p.scope ?? '—'],
    ...(p.projectPath ? [['Project', p.projectPath] as [string, string]] : []),
    ['Marketplace', p.marketplace || '—'],
    ['Version', p.version ?? '—'],
    ['Installed', p.installedAt ? new Date(p.installedAt).toLocaleString() : '—'],
    ['Updated', p.lastUpdated ? new Date(p.lastUpdated).toLocaleString() : '—'],
    ['MCP servers', p.mcpServers.join(', ') || '—'],
  ];
  return (
    <div>
      <button className={`${ghost} -ml-3`} onClick={onBack}>← Back</button>
      <div className="mt-2 text-base font-semibold text-zinc-100">{p.name}</div>
      {p.description && <div className="mt-1 text-sm leading-relaxed text-zinc-400">{p.description}</div>}
      <dl className={`${card} mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 px-4 py-3 text-sm`}>
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-zinc-500">{k}</dt><dd className="break-all text-zinc-200">{v}</dd></div>)}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={btn} disabled={busy} onClick={() => onAction(p.enabled ? 'disable' : 'enable')}>{p.enabled ? 'Disable' : 'Enable'}</button>
        <button className={btn} disabled={busy} onClick={() => onAction('update')}>Update</button>
        <button className={`${btn} !text-rose-300 hover:!border-rose-500/40`} disabled={busy} onClick={() => { if (confirm(`Uninstall ${p.id}?`)) onAction('uninstall'); }}>Uninstall</button>
      </div>
    </div>
  );
}
