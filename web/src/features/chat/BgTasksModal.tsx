import { useEffect, useRef, useState } from 'react';
import type { BgTask } from '@ccui/shared';
import { api } from '../../api';
import { Modal, card, ghost } from '../../lib/Modal';
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
  const task = chat.bgTasks.find((t) => t.taskId === openId);

  return (
    <Modal
      size="lg" onClose={onClose} title={task ? task.description : 'Em background'}
      actions={task ? <button className={ghost} onClick={() => setOpenId(null)}>← Voltar</button> : undefined}
    >
      {task
        ? <TaskDetail projectId={projectId} sessionId={sessionId} task={task} chat={chat} now={now} />
        : chat.bgTasks.length === 0
          ? <div className="py-10 text-center text-sm text-zinc-500">Nada rodando em background nesta sessão.</div>
          : (
            <ul className="space-y-2">
              {chat.bgTasks.map((t) => (
                <li key={t.taskId}>
                  <button className={`${card} flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:border-zinc-700 hover:bg-zinc-900/80`} onClick={() => setOpenId(t.taskId)}>
                    <span className={`w-24 shrink-0 ${STATUS[t.status].cls}`}>{t.status === 'running' ? '● ' : ''}{STATUS[t.status].label}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{t.description}</span>
                    <span className="shrink-0 font-mono text-xs text-zinc-500">{t.kind}</span>
                    <span className="w-16 shrink-0 text-right font-mono text-xs text-zinc-500">{fmtElapsed(t, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
    </Modal>
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
    <div className="flex min-h-0 flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-400">
        <span className={STATUS[task.status].cls}>{STATUS[task.status].label}</span>
        <span>{task.kind}</span>
        <span className="font-mono">{fmtElapsed(task, now)}</span>
        <span className="font-mono text-zinc-600">{task.taskId}</span>
        <span className="flex-1" />
        {running && (
          <button
            className="rounded-md border border-rose-500/40 px-3 py-1 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              api.stopBgTask(projectId, sessionId, task.taskId).catch((e: Error) => setErr(e.message)).finally(() => setStopping(false));
            }}
          >{stopping ? 'Parando…' : 'Parar'}</button>
        )}
      </div>
      {typeof command === 'string' && <pre className="whitespace-pre-wrap break-all rounded-lg bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-300">$ {command}</pre>}
      {task.summary && <div className="text-zinc-300">{task.summary}</div>}
      {err && <div className="text-rose-300">{err}</div>}
      <pre ref={pre} className="h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-black p-3 font-mono text-xs text-zinc-300">
        {out === null ? 'Carregando…' : out.output ?? (out.live ? 'Saída ainda não disponível para esta task.' : 'Processo da sessão encerrado: saída indisponível.')}
      </pre>
    </div>
  );
}
