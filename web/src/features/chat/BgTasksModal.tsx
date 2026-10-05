import { useEffect, useRef, useState } from 'react';
import type { BgTask } from '@ccui/shared';
import { api } from '../../api';
import type { Chat } from './reduce';

const STATUS: Record<BgTask['status'], { label: string; cls: string }> = {
  running: { label: 'rodando', cls: 'text-amber-300' },
  completed: { label: 'concluído', cls: 'text-emerald-300' },
  failed: { label: 'falhou', cls: 'text-rose-300' },
  stopped: { label: 'parado', cls: 'text-zinc-400' },
};
const POLL_MS = 2000;

function fmtElapsed(t: BgTask, now: number) {
  const s = Math.max(0, Math.round(((t.endedAt ?? now) - t.startedAt) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// what Claude left running in the background: list first, then one task's status and output tail
export function BgTasksModal({ projectId, sessionId, chat, onClose }: { projectId: string; sessionId: string; chat: Chat; onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') (openId ? setOpenId(null) : onClose()); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const task = chat.bgTasks.find((t) => t.taskId === openId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-left font-sans" onClick={onClose}>
      <div className="flex max-h-[80vh] w-[44rem] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          {task && <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={() => setOpenId(null)}>← Voltar</button>}
          <h2 className="text-sm font-semibold text-zinc-100">{task ? task.description : 'Em background'}</h2>
          <span className="flex-1" />
          <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        {task
          ? <TaskDetail projectId={projectId} sessionId={sessionId} task={task} chat={chat} now={now} />
          : chat.bgTasks.length === 0
            ? <div className="mt-3 text-xs text-zinc-500">Nada rodando em background nesta sessão.</div>
            : (
              <ul className="mt-3 divide-y divide-zinc-800 overflow-auto">
                {chat.bgTasks.map((t) => (
                  <li key={t.taskId}>
                    <button className="flex w-full items-center gap-3 px-1 py-2 text-left text-xs hover:bg-zinc-900" onClick={() => setOpenId(t.taskId)}>
                      <span className={`w-20 shrink-0 ${STATUS[t.status].cls}`}>{t.status === 'running' ? '● ' : ''}{STATUS[t.status].label}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-200">{t.description}</span>
                      <span className="shrink-0 font-mono text-zinc-500">{t.kind}</span>
                      <span className="w-16 shrink-0 text-right font-mono text-zinc-500">{fmtElapsed(t, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </div>
  );
}

function TaskDetail({ projectId, sessionId, task, chat, now }: { projectId: string; sessionId: string; task: BgTask; chat: Chat; now: number }) {
  const [out, setOut] = useState<{ live: boolean; output: string | null } | null>(null);
  const [err, setErr] = useState('');
  const [stopping, setStopping] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  const running = task.status === 'running';
  const tool = chat.items.find((x) => x.kind === 'tool' && x.toolUseId === task.toolUseId);
  const command = tool?.kind === 'tool' ? (tool.input as { command?: unknown } | null)?.command : undefined;

  // polls while running; one last read once it ends (the file keeps its final output)
  useEffect(() => {
    let alive = true;
    const load = () => api.bgOutput(projectId, sessionId, task.taskId).then((r) => { if (alive) { setOut(r); setErr(''); } }, (e: Error) => alive && setErr(e.message));
    void load();
    const t = running ? setInterval(load, POLL_MS) : undefined;
    return () => { alive = false; clearInterval(t); };
  }, [projectId, sessionId, task.taskId, running]);
  useEffect(() => { const el = pre.current; if (el) el.scrollTop = el.scrollHeight; }, [out?.output]);

  return (
    <div className="mt-3 flex min-h-0 flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-400">
        <span className={STATUS[task.status].cls}>{STATUS[task.status].label}</span>
        <span>{task.kind}</span>
        <span className="font-mono">{fmtElapsed(task, now)}</span>
        <span className="font-mono text-zinc-600">{task.taskId}</span>
        <span className="flex-1" />
        {running && (
          <button
            className="rounded-md border border-rose-500/40 px-2 py-0.5 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              api.stopBgTask(projectId, sessionId, task.taskId).catch((e: Error) => setErr(e.message)).finally(() => setStopping(false));
            }}
          >{stopping ? 'Parando…' : 'Parar'}</button>
        )}
      </div>
      {typeof command === 'string' && <pre className="whitespace-pre-wrap break-all rounded bg-zinc-900 px-2 py-1 font-mono text-zinc-300">$ {command}</pre>}
      {task.summary && <div className="text-zinc-300">{task.summary}</div>}
      {err && <div className="text-rose-300">{err}</div>}
      <pre ref={pre} className="min-h-[8rem] flex-1 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-800 bg-black p-2 font-mono text-[11px] text-zinc-300">
        {out === null ? 'Carregando…' : out.output ?? (out.live ? 'Saída ainda não disponível para esta task.' : 'Processo da sessão encerrado: saída indisponível.')}
      </pre>
    </div>
  );
}
