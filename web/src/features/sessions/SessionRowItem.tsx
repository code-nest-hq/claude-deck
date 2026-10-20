import type { SessionRow } from '@ccui/shared';
import { useApp } from '../../store';

export const ago = (t: number) => {
  const s = (t - Date.now()) / 1000, a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return a < 3600 ? f.format(Math.round(s / 60), 'minute') : a < 86400 ? f.format(Math.round(s / 3600), 'hour') : f.format(Math.round(s / 86400), 'day');
};

export function sessionDot(state: string | undefined, attention: boolean, live: boolean) {
  return state === 'awaiting_permission' ? 'bg-amber-400 animate-pulse' : state === 'running' ? 'bg-blue-500 animate-pulse' : attention || live ? 'bg-emerald-400' : 'bg-zinc-600';
}

const act = 'rounded px-1.5 py-0.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100';

// one session in a list: click opens the chat; hover reveals rename / tags / favorite / archive
export function SessionRowItem({ r, projectId, compact }: { r: SessionRow; projectId: string; compact?: boolean }) {
  const { open, patchSession } = useApp();
  const state = useApp((s) => s.chats[r.sessionId]?.state);
  const attention = useApp((s) => !!s.attention[r.sessionId]);
  return (
    <li className="group relative border-b border-zinc-800/60 last:border-b-0">
      <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-900/70" onClick={() => open(projectId, r.sessionId)}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sessionDot(state, attention, r.live)}`} />
        <span className={`min-w-0 flex-1 truncate text-sm ${attention ? 'font-semibold text-zinc-50' : r.archived ? 'text-zinc-500' : 'text-zinc-200'}`}>{r.favorite && <span className="mr-1 text-amber-400">★</span>}{r.name}</span>
        {!compact && r.tags.map((t) => <span key={t} className="hidden shrink-0 rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400 sm:inline">#{t}</span>)}
        <span className="shrink-0 font-mono text-[11px] text-zinc-600 group-hover:invisible">{ago(r.lastModified)}</span>
      </button>
      {!compact && (
        <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs shadow-lg group-hover:flex">
          <button className={act} title="Rename" onClick={async () => { const n = prompt('New session name', r.name); if (n?.trim()) await patchSession(r.sessionId, projectId, { name: n.trim() }); }}>Rename</button>
          <button className={act} title="Tags (comma separated)" onClick={async () => {
            const v = prompt('Tags, comma separated (letters, numbers, - and _)', r.tags.join(', '));
            if (v !== null) await patchSession(r.sessionId, projectId, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) }).catch((e) => alert((e as Error).message));
          }}>Tags</button>
          <button className={act} title={r.favorite ? 'Remove from favorites' : 'Favorite'} onClick={() => patchSession(r.sessionId, projectId, { favorite: !r.favorite })}>{r.favorite ? 'Unstar' : 'Star'}</button>
          <button className={act} title={r.archived ? 'Restore' : 'Archive'} onClick={() => patchSession(r.sessionId, projectId, { archived: !r.archived })}>{r.archived ? 'Restore' : 'Archive'}</button>
        </div>
      )}
    </li>
  );
}
