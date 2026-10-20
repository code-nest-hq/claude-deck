import { useApp } from '../../store';
import { useActivity, type ActivityEntry } from './activity';

const dotCls = { needs: 'bg-amber-400', running: 'bg-blue-500 animate-pulse' } as const;

export function ActivityPills() {
  const entries = useActivity();
  const setUi = useApp((s) => s.setUi);
  const needs = entries.filter((e) => e.kind === 'needs').length;
  const running = entries.length - needs;
  if (entries.length === 0) return null;
  const pill = 'flex items-center gap-1.5 rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100';
  return (
    <button className="flex items-center gap-2" title="Sessions that are working or need you" onClick={() => setUi({ activity: true })}>
      {running > 0 && <span className={pill}><span className={`h-1.5 w-1.5 rounded-full ${dotCls.running}`} />{running} running</span>}
      {needs > 0 && <span className={pill}><span className={`h-1.5 w-1.5 rounded-full ${dotCls.needs}`} />{needs} needs you</span>}
    </button>
  );
}

function Row({ e, onPick }: { e: ActivityEntry; onPick: () => void }) {
  return (
    <button className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-zinc-900" onClick={onPick}>
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotCls[e.kind]}`} />
      <span className="min-w-0">
        <span className="block truncate text-sm text-zinc-100">{e.projectName} – {e.sessionName}</span>
        <span className="block truncate text-xs text-zinc-500">{e.text}</span>
      </span>
    </button>
  );
}

// opened from the pills: every working / waiting session across projects, one click to jump in
export function ActivityOverlay() {
  const { ui, open, setUi } = useApp();
  const entries = useActivity();
  if (!ui.activity) return null;
  const close = () => setUi({ activity: false });
  return (
    <div className="fixed inset-0 z-40" onClick={close}>
      <div className="toast-in absolute right-5 top-14 w-80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]" onClick={(e) => e.stopPropagation()}>
        {entries.length === 0 && <div className="px-4 py-3 text-sm text-zinc-500">Nothing running right now.</div>}
        {entries.map((e) => <Row key={e.sessionId} e={e} onPick={() => { close(); open(e.projectId, e.sessionId); }} />)}
      </div>
    </div>
  );
}

// top-right stack: "needs you" cards stay until handled (derived from pending prompts), "finished" cards fade on their own
export function Toasts() {
  const { view, ui, rows, projects, toasts, open, dismissToast } = useApp();
  const entries = useActivity();
  const onScreen = (id: string) => view.name === 'chat' && view.sessionId === id && !ui.profile && !ui.logs;
  const needs = entries.filter((e) => e.kind === 'needs' && !onScreen(e.sessionId));
  const done = toasts.filter((t) => !onScreen(t.sessionId));
  if (needs.length + done.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-30 flex w-72 flex-col gap-2">
      {needs.map((e) => (
        <button key={e.sessionId} className="toast-in pointer-events-auto rounded-lg border border-zinc-800 bg-zinc-950/95 px-3 py-2.5 text-left shadow-[0_10px_28px_-12px_rgba(0,0,0,0.7)] backdrop-blur transition-colors hover:border-zinc-700" onClick={() => open(e.projectId, e.sessionId)}>
          <span className="flex items-center gap-2 text-xs font-medium text-zinc-100"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" /><span className="truncate">{e.projectName} – {e.sessionName}</span></span>
          <span className="mt-0.5 block truncate pl-3.5 text-[11px] text-zinc-500">{e.text}</span>
        </button>
      ))}
      {done.map((t) => {
        const project = projects.find((p) => p.id === t.projectId);
        const name = rows[t.projectId]?.find((r) => r.sessionId === t.sessionId)?.name ?? 'Session';
        return (
          <button key={t.id} className="toast-in pointer-events-auto rounded-lg border border-zinc-800 bg-zinc-950/95 px-3 py-2.5 text-left shadow-[0_10px_28px_-12px_rgba(0,0,0,0.7)] backdrop-blur transition-colors hover:border-zinc-700" onClick={() => { dismissToast(t.id); open(t.projectId, t.sessionId); }}>
            <span className="flex items-center gap-2 text-xs font-medium text-zinc-100"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" /><span className="truncate">{project?.name ?? 'Project'} – {name}</span></span>
            <span className="mt-0.5 block pl-3.5 text-[11px] text-zinc-500">Finished</span>
          </button>
        );
      })}
    </div>
  );
}
