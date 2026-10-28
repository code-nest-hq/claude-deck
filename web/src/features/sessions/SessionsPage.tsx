import { useEffect, useState } from 'react';
import { IconPlus } from '../../lib/icons';
import { matchRow } from '../../lib/search';
import { useApp } from '../../store';
import { barBtnPrimary, TopBar } from '../home/TopBar';
import { SessionRowItem } from './SessionRowItem';

export function SessionsPage({ projectId }: { projectId: string }) {
  const { projects, rows, go, setUi } = useApp();
  const [query, setQuery] = useState('');
  const p = projects.find((x) => x.id === projectId);
  useEffect(() => { if (!p) go({ name: 'home' }); }, [p, go]);
  if (!p) return null;
  const all = (rows[p.id] ?? []).filter((r) => matchRow(r, query)).sort((a, b) => b.lastModified - a.lastModified);
  const openRows = all.filter((r) => !r.archived);
  const archived = all.filter((r) => r.archived);
  const section = (title: string, list: typeof all, empty: string) => (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2 text-sm font-medium text-zinc-300">{title}<span className="font-mono text-xs font-normal text-zinc-600">{list.length}</span></h2>
      <ul className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
        {list.length === 0 && <li className="px-4 py-6 text-sm text-zinc-600">{empty}</li>}
        {list.map((r) => <SessionRowItem key={r.sessionId} r={r} projectId={p.id} />)}
      </ul>
    </section>
  );
  return (
    <div className="flex h-full flex-col">
      <TopBar back={p.name} crumb="Sessions">
        <button className={barBtnPrimary} onClick={() => setUi({ newSession: true, newFor: p.id })}><IconPlus className="h-3.5 w-3.5" /> New session</button>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight text-zinc-100">Sessions</h1>
        <input
          className="mb-8 w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-zinc-600"
          placeholder="Search by name or #tag…" aria-label="Search sessions" value={query} onChange={(e) => setQuery(e.target.value)}
        />
        <div className="grid gap-10 xl:grid-cols-2">
          {section('Open', openRows, query ? 'No matching sessions.' : 'No open sessions.')}
          {section('Archived', archived, 'Nothing archived.')}
        </div>
      </div>
    </div>
  );
}
