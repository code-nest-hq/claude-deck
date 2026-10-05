import { useEffect, useMemo, useState } from 'react';
import type { LogEntry } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';

const field = 'rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700';
const LEVEL = { error: 'bg-rose-500/15 text-rose-300', warn: 'bg-amber-500/15 text-amber-300' } as const;

function Row({ e, open, onToggle }: { e: LogEntry; open: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(e.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); };
  return (
    <li className="rounded-md border border-zinc-800/80 bg-zinc-900/40">
      <button className="flex w-full items-baseline gap-2 px-3 py-2 text-left" onClick={onToggle}>
        <span className="shrink-0 font-mono text-[11px] text-zinc-500">{new Date(e.ts).toLocaleTimeString()}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${LEVEL[e.level]}`}>{e.level}</span>
        <span className="shrink-0 font-mono text-[11px] text-zinc-400">{e.source}{e.code ? `/${e.code}` : ''}</span>
        {e.projectName && <span className="shrink-0 text-[11px] text-zinc-400">{e.projectName}{e.sessionName ? ` · ${e.sessionName}` : ''}</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{e.message.split('\n')[0]}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800/80 px-3 py-2">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[11px] text-zinc-400">ID: {e.id}</span>
            <button className="text-[11px] text-zinc-500 hover:text-zinc-200" onClick={copy}>{copied ? 'copiado ✓' : 'copiar'}</button>
          </div>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">{JSON.stringify(e, null, 2)}</pre>
        </div>
      )}
    </li>
  );
}

// Daily error log of every session, live: the chosen day's file plus entries pushed over the WebSocket while open
export function LogsPage({ onClose }: { onClose: () => void }) {
  const { projects, logs: live, ui, setUi } = useApp();
  const [day, setDay] = useState<string | null>(null); // null = today (server's local date)
  const [data, setData] = useState<{ day: string; days: string[]; entries: LogEntry[] } | null>(null);
  const [err, setErr] = useState('');
  const [project, setProject] = useState('');
  const [level, setLevel] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const text = ui.logFilter;

  useEffect(() => {
    let stale = false;
    api.logs(day ?? undefined).then((d) => { if (!stale) { setData(d); setErr(''); } }).catch((e) => setErr((e as Error).message));
    return () => { stale = true; };
  }, [day]);

  const entries = useMemo(() => {
    if (!data) return [];
    const seen = new Set(data.entries.map((e) => e.id));
    // live entries belong to the day they were written on (same local-date rule as the server's file name)
    const extra = live.filter((e) => !seen.has(e.id) && new Date(e.ts).toLocaleDateString('sv') === data.day);
    const q = text.trim().toLowerCase();
    return [...data.entries, ...extra]
      .filter((e) => (!project || e.projectId === project) && (!level || e.level === level) && (!q || JSON.stringify(e).toLowerCase().includes(q)))
      .reverse();
  }, [data, live, project, level, text]);

  // an exact id in the filter opens that entry
  useEffect(() => { if (entries.length === 1 && entries[0].id === text.trim()) setOpen(entries[0].id); }, [entries, text]);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Logs</h1>
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onClose}>Fechar</button>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">
        Erros de todas as sessões, em tempo real. Um arquivo por dia em <span className="font-mono">~/.code-nest/logs/</span>. Cole o ID mostrado junto a um erro para achar a entrada completa.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={field} value={data?.day ?? ''} onChange={(e) => setDay(e.target.value)}>
          {[...new Set([data?.day, ...(data?.days ?? [])].filter(Boolean) as string[])].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className={field} value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Todos os projetos</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={field} value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">error + warn</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
        </select>
        <input className={`${field} min-w-48 flex-1`} placeholder="Filtrar por texto ou ID do erro…" value={text} onChange={(e) => setUi({ logFilter: e.target.value })} />
      </div>
      {err && <div className="mb-2 text-xs text-rose-400">{err}</div>}
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{entries.length} entradas</div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {!data ? <li className="text-xs text-zinc-500">Carregando…</li>
          : entries.length === 0 ? <li className="text-xs text-zinc-600">Nenhum erro {text || project || level ? 'com esse filtro' : 'neste dia'}.</li>
          : entries.map((e) => <Row key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />)}
      </ul>
    </div>
  );
}
