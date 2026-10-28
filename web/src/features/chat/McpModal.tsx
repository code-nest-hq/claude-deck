import { useState } from 'react';
import type { McpAction, McpServerView, McpStatus } from '@ccui/shared';
import { useApp } from '../../store';
import { Modal, card, field, ghost, secondary } from '../../lib/Modal';
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
  return <span className={`whitespace-nowrap text-xs ${cls}`}>{icon} {label}</span>;
}

// "MCP" header button / `/mcp`: interactive modal; reads the latest `mcp` item of the chat (opening it requests a fresh status)
export function McpModal({ it, onClose }: { it?: Mcp; onClose: () => void }) {
  const mcp = useApp((s) => s.mcp);
  const [open, setOpen] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [q, setQ] = useState('');
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
  const act = (a: McpAction) => it && mcp(it.id, a);

  return (
    <Modal
      size="lg" onClose={onClose} title="MCP servers"
      subtitle={it?.servers ? `${servers.length} · ${count('connected')} connected · ${count('failed') + count('needs-auth')} need attention · ${count('disabled')} disabled` : undefined}
      actions={loading ? <span className="mt-1 text-sm text-zinc-500">Loading…</span> : <button className={ghost} onClick={() => mcp()}>Refresh</button>}
    >
      {it?.error && <div className="mb-3 whitespace-pre-wrap rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{it.error}</div>}
      {it?.servers && servers.length === 0 && !it.error && <div className="py-10 text-center text-sm text-zinc-500">No MCP servers configured.</div>}

      {sel ? (
        <ServerDetail
          s={sel} busy={loading} showTools={showTools}
          onBack={() => { setOpen(null); setShowTools(false); }}
          onTools={() => setShowTools((v) => !v)} onAction={(a) => act({ ...a, server: sel.name })}
        />
      ) : (
        <>
          {servers.length > 5 && (
            <input className={`${field} mb-4`} placeholder="Filter servers…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          )}
          <div className="space-y-5">
            {groups.map(([label, list]) => (
              <section key={label}>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</div>
                <div className="space-y-2">
                  {list.map((x) => (
                    <button key={x.name} className={`${card} flex w-full items-center gap-3 px-4 py-3 text-left hover:border-zinc-700 hover:bg-zinc-900/80`} onClick={() => setOpen(x.name)}>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{x.name}</span>
                      {x.status === 'connected' && <span className="text-xs text-zinc-500">{x.tools.length} tool(s)</span>}
                      <Status s={x.status} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function ServerDetail({ s, busy, showTools, onBack, onTools, onAction }: {
  s: McpServerView; busy: boolean; showTools: boolean;
  onBack: () => void; onTools: () => void; onAction: (a: Omit<McpAction, 'server'>) => void;
}) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Status', <Status s={s.status} />],
    ['Scope', s.scope ?? '—'],
    ['Transport', s.transport ?? '—'],
    [s.transport === 'stdio' ? 'Command' : 'URL', s.target ?? '—'],
    ...(s.serverInfo ? [['Server', `${s.serverInfo.name} ${s.serverInfo.version}`] as [string, string]] : []),
    ['Tools', `${s.tools.length} tool(s)`],
  ];
  const btn = secondary;
  const [cb, setCb] = useState('');
  const own = s.scope !== 'claudeai';
  return (
    <div>
      <button className={`${ghost} -ml-3`} onClick={onBack}>← Back</button>
      <div className="mt-2 text-base font-semibold text-zinc-100">{s.name} MCP Server</div>
      <dl className={`${card} mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 px-4 py-3 text-sm`}>
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-zinc-500">{k}</dt><dd className="break-all text-zinc-200">{v}</dd></div>)}
      </dl>
      {s.error && <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">{s.error}</pre>}
      {s.status === 'needs-auth' && (s.scope === 'claudeai'
        ? <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-300/90">claude.ai connectors are authenticated on claude.ai: sign in there, then click Reconnect.</div>
        : <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-300/90">Sign in via OAuth: click Authenticate and finish in the browser. It completes automatically; if the final page fails to load, copy its address and paste it below.</div>)}
      {s.authUrl && (
        <div className={`${card} mt-3 space-y-2 px-4 py-3 text-sm`}>
          <a className="break-all text-sky-300 underline" href={s.authUrl} target="_blank" rel="noopener noreferrer">Open sign-in page ↗</a>
          <div className="flex gap-2">
            <input className={field} placeholder="Paste the redirected URL (http://localhost:…?code=…)" value={cb} onChange={(e) => setCb(e.target.value)} />
            <button className={btn} disabled={busy || !cb.trim()} onClick={() => { onAction({ kind: 'authCallback', callbackUrl: cb.trim() }); setCb(''); }}>Submit</button>
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {s.scope === 'claudeai' && s.status === 'needs-auth' && (
          <a className={btn} href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer">Open claude.ai connectors ↗</a>
        )}
        {s.tools.length > 0 && <button className={btn} onClick={onTools}>{showTools ? 'Hide tools' : 'View tools'}</button>}
        {own && s.status === 'needs-auth' && <button className={btn} disabled={busy} onClick={() => onAction({ kind: 'auth' })}>Authenticate</button>}
        {own && s.status === 'connected' && s.transport !== 'stdio' && <button className={btn} disabled={busy} onClick={() => onAction({ kind: 'clearAuth' })}>Sign out</button>}
        {s.status !== 'disabled' && <button className={btn} disabled={busy} onClick={() => onAction({ kind: 'reconnect' })}>Reconnect</button>}
        <button className={btn} disabled={busy} onClick={() => onAction({ kind: s.status === 'disabled' ? 'enable' : 'disable' })}>{s.status === 'disabled' ? 'Enable' : 'Disable'}</button>
      </div>
      {showTools && (
        <ul className={`${card} mt-4 space-y-1.5 px-4 py-3 text-sm`}>
          {s.tools.map((t) => (
            <li key={t.name}><span className="font-mono text-xs text-sky-300">{t.name}</span>{t.description && <span className="text-zinc-500"> — {t.description.split('\n')[0]}</span>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
