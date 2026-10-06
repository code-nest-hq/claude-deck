import { useEffect, useState } from 'react';
import type { McpServerView, McpStatus } from '@ccui/shared';
import { useApp } from '../../store';
import type { Item } from './reduce';

type Mcp = Extract<Item, { kind: 'mcp' }>;

// same labels/order as the terminal's /mcp
const SCOPES: Array<[string, string]> = [
  ['project', 'Project MCPs (.mcp.json)'],
  ['local', 'Local MCPs (~/.claude.json, this project)'],
  ['user', 'User MCPs (~/.claude.json)'],
  ['plugin', 'Plugin MCPs'],
  ['claudeai', 'claude.ai'],
  ['managed', 'Enterprise MCPs'],
  ['enterprise', 'Enterprise MCPs'],
  ['dynamic', 'Dynamic MCPs'],
];
const STATUS: Record<McpStatus, [string, string, string]> = {
  connected: ['✔', 'connected', 'text-emerald-400'],
  failed: ['✘', 'failed', 'text-rose-400'],
  'needs-auth': ['△', 'needs authentication', 'text-amber-400'],
  pending: ['◯', 'connecting…', 'text-zinc-400'],
  disabled: ['◯', 'disabled', 'text-zinc-500'],
};

function Status({ s }: { s: McpStatus }) {
  const [icon, label, cls] = STATUS[s];
  return <span className={cls}>{icon} {label}</span>;
}

// "MCP" header button / `/mcp`: interactive modal; reads the latest `mcp` item of the chat (opening it requests a fresh status)
export function McpModal({ it, onClose }: { it?: Mcp; onClose: () => void }) {
  const mcp = useApp((s) => s.mcp);
  const [open, setOpen] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const servers = it?.servers ?? [];
  const loading = !it || it.loading;
  const count = (s: McpStatus) => servers.filter((x) => x.status === s).length;
  const known = new Set(SCOPES.map(([k]) => k));
  const shown = servers.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = [
    ...SCOPES.map(([k, label]) => [label, shown.filter((x) => x.scope === k)] as const),
    ['Other MCPs', shown.filter((x) => !x.scope || !known.has(x.scope))] as const,
  ].filter(([, list]) => list.length > 0);
  const sel = servers.find((x) => x.name === open);
  const act = (kind: 'reconnect' | 'enable' | 'disable', server: string) => it && mcp(it.id, { kind, server });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-left font-sans" onClick={onClose}>
      <div className="max-h-[80vh] w-[40rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4 font-mono text-xs text-zinc-300" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="font-sans text-sm font-semibold text-zinc-100">MCP servers</h2>
          <span className="text-zinc-500">
            {it?.servers ? `${servers.length} · ${count('connected')} connected · ${count('failed') + count('needs-auth')} need attention · ${count('disabled')} disabled` : ''}
          </span>
          <span className="flex-1" />
          {loading
            ? <span className="font-sans text-zinc-500">loading…</span>
            : <button className="font-sans text-[11px] text-zinc-500 hover:text-zinc-200" onClick={() => mcp()}>Refresh</button>}
          <button className="font-sans text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        {it?.error && <div className="mt-2 whitespace-pre-wrap text-rose-300">{it.error}</div>}
        {it?.servers && servers.length === 0 && !it.error && <div className="mt-2 text-zinc-500">No MCP servers configured.</div>}

        {sel ? (
          <ServerDetail
            s={sel} busy={loading} showTools={showTools}
            onBack={() => { setOpen(null); setShowTools(false); }}
            onTools={() => setShowTools((v) => !v)} onAction={(k) => act(k, sel.name)}
          />
        ) : (
          <>
            {servers.length > 5 && (
              <input className="mt-2 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-sans outline-none focus:border-zinc-600" placeholder="Filtrar servidores…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            )}
            {groups.map(([label, list]) => (
              <div key={label} className="mt-3">
                <div className="text-zinc-500">{label}</div>
                {list.map((x) => (
                  <button key={x.name} className="mt-1 flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/70" onClick={() => setOpen(x.name)}>
                    <span className="text-zinc-100">{x.name}</span>
                    <span className="flex-1" />
                    {x.status === 'connected' && <span className="text-zinc-500">{x.tools.length} tool(s)</span>}
                    <Status s={x.status} />
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ServerDetail({ s, busy, showTools, onBack, onTools, onAction }: {
  s: McpServerView; busy: boolean; showTools: boolean;
  onBack: () => void; onTools: () => void; onAction: (k: 'reconnect' | 'enable' | 'disable') => void;
}) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Status', <Status s={s.status} />],
    ['Scope', s.scope ?? '—'],
    ['Transport', s.transport ?? '—'],
    [s.transport === 'stdio' ? 'Command' : 'URL', s.target ?? '—'],
    ...(s.serverInfo ? [['Server', `${s.serverInfo.name} ${s.serverInfo.version}`] as [string, string]] : []),
    ['Tools', `${s.tools.length} tool(s)`],
  ];
  const btn = 'rounded border border-zinc-800 px-2 py-0.5 font-sans text-[11px] hover:bg-zinc-800 disabled:opacity-40';
  return (
    <div className="mt-2">
      <button className="font-sans text-[11px] text-zinc-500 hover:text-zinc-200" onClick={onBack}>← Back</button>
      <div className="mt-1 text-sm font-semibold text-zinc-100">{s.name} MCP Server</div>
      <table className="mt-1">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}><td className="pr-3 align-top text-zinc-500">{k}:</td><td className="break-all">{v}</td></tr>
          ))}
        </tbody>
      </table>
      {s.error && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-rose-300">{s.error}</pre>}
      {s.status === 'needs-auth' && (s.scope === 'claudeai'
        ? <div className="mt-1 text-amber-300/80">claude.ai connectors are authenticated on claude.ai: sign in there, then click Reconnect.</div>
        : <div className="mt-1 text-amber-300/80">Authentication happens in the browser via OAuth: run <code>/mcp</code> once in the terminal <code>claude</code> to sign in.</div>)}
      <div className="mt-2 flex flex-wrap gap-2">
        {s.scope === 'claudeai' && s.status === 'needs-auth' && (
          <a className={btn} href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer">Open claude.ai connectors ↗</a>
        )}
        {s.tools.length > 0 && <button className={btn} onClick={onTools}>{showTools ? 'Hide tools' : 'View tools'}</button>}
        {s.status !== 'disabled' && <button className={btn} disabled={busy} onClick={() => onAction('reconnect')}>Reconnect</button>}
        <button className={btn} disabled={busy} onClick={() => onAction(s.status === 'disabled' ? 'enable' : 'disable')}>{s.status === 'disabled' ? 'Enable' : 'Disable'}</button>
      </div>
      {showTools && (
        <ul className="mt-2 max-h-72 space-y-1 overflow-auto">
          {s.tools.map((t) => (
            <li key={t.name}><span className="text-sky-300">{t.name}</span>{t.description && <span className="text-zinc-500"> — {t.description.split('\n')[0]}</span>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
