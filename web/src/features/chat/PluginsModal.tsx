import { useCallback, useEffect, useState } from 'react';
import type { PluginAction, PluginsView, PluginView } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';

type Tab = 'installed' | 'discover' | 'marketplaces';
type Scope = 'user' | 'project' | 'local';
const MAX_SHOWN = 100;

const btn = 'rounded border border-zinc-800 px-2 py-0.5 font-sans text-[11px] hover:bg-zinc-800 disabled:opacity-40';

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

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
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
  const tabCls = (t: Tab) => `rounded px-2 py-0.5 font-sans text-[11px] ${tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-left font-sans" onClick={onClose}>
      <div className="max-h-[80vh] w-[44rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4 font-mono text-xs text-zinc-300" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="font-sans text-sm font-semibold text-zinc-100">Plugins</h2>
          <span className="text-zinc-500">{view ? `${view.installed.length} installed · ${view.installed.filter((p) => p.enabled).length} enabled · ${view.marketplaces.length} marketplaces` : ''}</span>
          <span className="flex-1" />
          {busy ? <span className="font-sans text-zinc-500">working…</span> : <button className="font-sans text-[11px] text-zinc-500 hover:text-zinc-200" onClick={() => void load()}>Refresh</button>}
          <button className="font-sans text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        <div className="mt-2 flex items-center gap-1">
          <button className={tabCls('installed')} onClick={() => { setTab('installed'); setOpen(null); }}>Installed</button>
          <button className={tabCls('discover')} onClick={() => { setTab('discover'); setOpen(null); }}>Discover</button>
          <button className={tabCls('marketplaces')} onClick={() => { setTab('marketplaces'); setOpen(null); }}>Marketplaces</button>
          <span className="flex-1" />
          {tab !== 'marketplaces' && <input className="w-52 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-sans outline-none focus:border-zinc-600" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />}
        </div>
        {error && <div className="mt-2 whitespace-pre-wrap text-rose-300">{error}</div>}
        {msg && <pre className={`mt-2 max-h-32 overflow-auto whitespace-pre-wrap ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</pre>}
        {!view && !error && <div className="mt-2 text-zinc-500">loading…</div>}

        {view && tab === 'installed' && (sel ? (
          <Detail p={sel} busy={busy} onBack={() => setOpen(null)} onAction={(kind) => void act({ kind, plugin: sel.id, scope: sel.scope as Scope | undefined })} />
        ) : (
          <>
            {installed.length === 0 && <div className="mt-2 text-zinc-500">No plugins installed.</div>}
            {installed.map((p) => (
              <button key={`${p.id}|${p.scope}|${p.projectPath ?? ''}`} className="mt-1 flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/70" onClick={() => setOpen(`${p.id}|${p.scope}|${p.projectPath ?? ''}`)}>
                <span className="text-zinc-100">{p.name}</span>
                <span className="text-zinc-500">{p.marketplace}{p.version ? ` · ${p.version}` : ''}</span>
                <span className="flex-1" />
                <span className="text-zinc-500">{p.scope}</span>
                <span className={p.enabled ? 'text-emerald-400' : 'text-zinc-500'}>{p.enabled ? '✔ enabled' : '◯ disabled'}</span>
              </button>
            ))}
          </>
        ))}

        {view && tab === 'discover' && (
          <>
            <div className="mt-2 flex items-center gap-2 text-zinc-500">
              Install scope
              <select className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 font-sans text-zinc-200" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="user">user (all projects)</option>
                <option value="project">project (shared, .claude/settings.json)</option>
                <option value="local">local (this project, private)</option>
              </select>
            </div>
            {available.length === 0 && <div className="mt-2 text-zinc-500">{needle ? 'No match.' : 'Nothing to install: add a marketplace first.'}</div>}
            {available.slice(0, MAX_SHOWN).map((p) => (
              <div key={p.id} className="mt-1 flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div><span className="text-zinc-100">{p.name}</span> <span className="text-zinc-500">{p.marketplace}{p.category ? ` · ${p.category}` : ''}</span></div>
                  {p.description && <div className="line-clamp-2 font-sans text-zinc-500">{p.description}</div>}
                </div>
                <button className={btn} disabled={busy} onClick={() => void act({ kind: 'install', plugin: p.id, scope })}>Install</button>
              </div>
            ))}
            {available.length > MAX_SHOWN && <div className="mt-2 text-zinc-500">{available.length - MAX_SHOWN} more: refine the filter.</div>}
          </>
        )}

        {view && tab === 'marketplaces' && (
          <>
            {view.marketplaces.map((m) => (
              <div key={m.name} className="mt-1 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5">
                <span className="text-zinc-100">{m.name}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-500">{m.source}{m.target ? `: ${m.target}` : ''}</span>
                <button className={btn} disabled={busy} onClick={() => void act({ kind: 'marketplace.update', name: m.name })}>Update</button>
                <button className={btn} disabled={busy} onClick={() => { if (confirm(`Remove marketplace ${m.name}? Plugins installed from it are uninstalled.`)) void act({ kind: 'marketplace.remove', name: m.name }); }}>Remove</button>
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <input className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-sans outline-none focus:border-zinc-600" placeholder="owner/repo, git URL or path" value={source} onChange={(e) => setSource(e.target.value)} />
              <button className={btn} disabled={busy || !source.trim()} onClick={async () => { await act({ kind: 'marketplace.add', source: source.trim() }); setSource(''); }}>Add marketplace</button>
              <button className={btn} disabled={busy} onClick={() => void act({ kind: 'marketplace.update' })}>Update all</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Detail({ p, busy, onBack, onAction }: { p: PluginView; busy: boolean; onBack: () => void; onAction: (k: 'enable' | 'disable' | 'update' | 'uninstall') => void }) {
  const rows: Array<[string, string]> = [
    ['Status', p.enabled ? '✔ enabled' : '◯ disabled'],
    ['Scope', p.scope ?? '—'],
    ...(p.projectPath ? [['Project', p.projectPath] as [string, string]] : []),
    ['Marketplace', p.marketplace || '—'],
    ['Version', p.version ?? '—'],
    ['Installed', p.installedAt ? new Date(p.installedAt).toLocaleString() : '—'],
    ['Updated', p.lastUpdated ? new Date(p.lastUpdated).toLocaleString() : '—'],
    ['MCP servers', p.mcpServers.join(', ') || '—'],
  ];
  return (
    <div className="mt-2">
      <button className="font-sans text-[11px] text-zinc-500 hover:text-zinc-200" onClick={onBack}>← Back</button>
      <div className="mt-1 text-sm font-semibold text-zinc-100">{p.name}</div>
      {p.description && <div className="mt-1 font-sans text-zinc-400">{p.description}</div>}
      <table className="mt-1">
        <tbody>{rows.map(([k, v]) => <tr key={k}><td className="pr-3 align-top text-zinc-500">{k}:</td><td className="break-all">{v}</td></tr>)}</tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={btn} disabled={busy} onClick={() => onAction(p.enabled ? 'disable' : 'enable')}>{p.enabled ? 'Disable' : 'Enable'}</button>
        <button className={btn} disabled={busy} onClick={() => onAction('update')}>Update</button>
        <button className={btn} disabled={busy} onClick={() => { if (confirm(`Uninstall ${p.id}?`)) onAction('uninstall'); }}>Uninstall</button>
      </div>
    </div>
  );
}
