import { projectColor } from '../../lib/projectColor';
import { useApp } from '../../store';

// Pinned projects: always visible above every screen; hover reveals the two quick actions
export function PinnedBar() {
  const { projects, go, setUi } = useApp();
  const pinned = projects.filter((p) => p.pinned);
  if (!pinned.length) return null;
  const act = 'flex-1 truncate px-2 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50';
  return (
    <div className="flex shrink-0 flex-wrap justify-center gap-2 border-b border-zinc-800/70 bg-zinc-950 px-5 py-2">
      {pinned.map((p) => (
        <div key={p.id} className="group relative h-8 w-44 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900" style={{ borderTopColor: projectColor(p) }}>
          <span className="flex h-full items-center justify-center truncate px-3 text-xs font-medium text-zinc-100">{p.name}</span>
          <div className="absolute inset-0 hidden divide-x divide-zinc-700 bg-zinc-900 group-focus-within:flex group-hover:flex">
            <button className={act} onClick={() => go({ name: 'sessions', projectId: p.id })}>Go to sessions</button>
            <button className={act} onClick={() => setUi({ newSession: true, newFor: p.id })}>Start session</button>
          </div>
        </div>
      ))}
    </div>
  );
}
