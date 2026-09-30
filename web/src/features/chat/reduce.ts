import { ZERO_TOTALS, type ClaudeEvent, type McpServerView, type Model, type ModelUsage, type PendingPermission, type ServerMsg, type SessionState, type UsageTotals } from '@ccui/shared';

export type Item =
  | { kind: 'user'; text: string; routedModel?: Model }
  | { kind: 'assistant'; text: string; streaming?: boolean }
  | { kind: 'tool'; toolUseId: string; name: string; input: unknown; output?: string; isError?: boolean }
  | { kind: 'shell'; id: string; command: string; output?: string; exitCode?: number | null; truncated?: boolean }
  | { kind: 'mcp'; id: string; servers?: McpServerView[]; loading: boolean; error?: string }
  | { kind: 'turn'; modelUsage: Record<string, ModelUsage>; skills: SkillUse[] }
  | { kind: 'error'; text: string };

// a skill used in a turn: typed by the user as "/name" (a candidate: the view keeps only known non-builtin commands)
// or invoked by Claude through the Skill tool
export interface SkillUse { name: string; by: 'user' | 'claude'; args?: string; output?: string; isError?: boolean }

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused';
// log de um subagente (Task tool): items é só o que ele chamou de ferramenta, sem texto de raciocínio (ver spec)
export interface TaskEntry { taskId: string; label: string; status: TaskStatus; items: Item[] }

export interface Chat {
  hydrated: boolean;
  items: Item[];
  state: SessionState;
  lastSeq: number;
  totals: UsageTotals;
  lastTokens?: { input: number; output: number; cacheCreation: number; cacheRead: number };
  pending: PendingPermission[];
  lastEventAt: number;
  tasks: TaskEntry[];
  pendingRoutedModel?: Model; // "prateleira" pro modelo escolhido; consumido pelo próximo user.message
  turnPhase: 'idle' | 'routing' | 'thinking'; // indicador de progresso enquanto não chega nenhum conteúdo do turno
  turnPhaseAt: number;
  // last context occupancy (seq = its event, so the auto-compact prompt fires once per turn)
  context?: { percentage: number; totalTokens: number; maxTokens: number; seq: number };
  compact?: { phase: 'running' | 'done' | 'failed'; startedAt: number; seq: number; preTokens?: number; postTokens?: number; message?: string };
}

export const emptyChat = (): Chat => ({ hydrated: false, items: [], state: 'idle', lastSeq: 0, totals: ZERO_TOTALS, pending: [], lastEventAt: Date.now(), tasks: [], turnPhase: 'idle', turnPhaseAt: 0 });

export function applySnapshot(s: Extract<ServerMsg, { type: 'snapshot' }>): Chat {
  return {
    hydrated: true,
    items: s.history.map((h) => ({ kind: h.role, text: h.text })),
    state: s.state,
    lastSeq: s.lastSeq,
    totals: s.totals,
    pending: s.pending,
    lastEventAt: Date.now(),
    tasks: [], // subagentes não persistem entre reconexões (fora de escopo, ver spec)
    turnPhase: 'idle',
    turnPhaseAt: 0,
  };
}

export const addError = (c: Chat, text: string): Chat => ({ ...c, items: [...c.items, { kind: 'error', text }] });

// injeta um item novo dentro do TaskEntry certo; cria o task defensivamente se task.started ainda não chegou
function upsertTaskItem(tasks: TaskEntry[], taskId: string, item: Item): TaskEntry[] {
  const i = tasks.findIndex((t) => t.taskId === taskId);
  if (i < 0) return [...tasks, { taskId, label: taskId.slice(0, 8), status: 'running', items: [item] }];
  const next = tasks.slice();
  next[i] = { ...next[i], items: [...next[i].items, item] };
  return next;
}

// skills from the turn's user message up to now (subagent calls live in tasks, not here)
function turnSkills(items: Item[]): SkillUse[] {
  let i = items.length - 1;
  while (i >= 0 && items[i].kind !== 'user') i--;
  const out: SkillUse[] = [];
  const u = items[i];
  const m = u?.kind === 'user' ? /^\/(\S+)\s*([\s\S]*)$/.exec(u.text) : null;
  if (m) out.push({ name: m[1], by: 'user', ...(m[2].trim() ? { args: m[2].trim() } : {}) });
  for (const x of items.slice(i + 1)) {
    if (x.kind !== 'tool' || x.name !== 'Skill') continue;
    const inp = (x.input ?? {}) as { skill?: unknown; args?: unknown };
    out.push({ name: String(inp.skill ?? '?'), by: 'claude', ...(typeof inp.args === 'string' && inp.args ? { args: inp.args } : {}), output: x.output, isError: x.isError });
  }
  return out;
}

// eventos antes do snapshot ou já vistos (seq <= lastSeq) são ignorados: dedupe na reconexão
export function applyEvent(c: Chat, ev: ClaudeEvent): Chat {
  if (!c.hydrated || ev.seq <= c.lastSeq) return c;
  const items = c.items.slice();
  const last = items[items.length - 1];
  const next: Chat = { ...c, items, lastSeq: ev.seq, lastEventAt: ev.ts };
  // the progress indicator stays up for the whole turn (thinking, tools, streaming) and only ends with it
  if (ev.type === 'turn.completed' || ev.type === 'error' || (ev.type === 'session.state' && (ev.state === 'idle' || ev.state === 'exited'))) next.turnPhase = 'idle';
  switch (ev.type) {
    case 'user.message':
      items.push({ kind: 'user', text: ev.text, routedModel: c.pendingRoutedModel });
      next.pendingRoutedModel = undefined;
      if (c.turnPhase !== 'thinking') { next.turnPhase = 'thinking'; next.turnPhaseAt = ev.ts; }
      break;
    case 'routing.started':
      next.turnPhase = 'routing';
      next.turnPhaseAt = ev.ts;
      break;
    case 'model.routed':
      next.pendingRoutedModel = ev.model;
      next.turnPhase = 'thinking';
      next.turnPhaseAt = ev.ts;
      break;
    case 'message.delta':
      if (last?.kind === 'assistant' && last.streaming) items[items.length - 1] = { ...last, text: last.text + ev.text };
      else items.push({ kind: 'assistant', text: ev.text, streaming: true });
      break;
    case 'message.completed':
      if (last?.kind === 'assistant' && last.streaming) items[items.length - 1] = { kind: 'assistant', text: ev.text };
      else items.push({ kind: 'assistant', text: ev.text });
      break;
    case 'tool.started':
      if (ev.taskId) next.tasks = upsertTaskItem(c.tasks, ev.taskId, { kind: 'tool', toolUseId: ev.toolUseId, name: ev.name, input: ev.input });
      else items.push({ kind: 'tool', toolUseId: ev.toolUseId, name: ev.name, input: ev.input });
      break;
    case 'tool.result': {
      if (ev.taskId) {
        next.tasks = c.tasks.map((t) => t.taskId !== ev.taskId ? t : {
          ...t,
          items: t.items.map((x) => (x.kind === 'tool' && x.toolUseId === ev.toolUseId ? { ...x, output: ev.output, isError: ev.isError } : x)),
        });
      } else {
        const i = items.findIndex((x) => x.kind === 'tool' && x.toolUseId === ev.toolUseId);
        if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: 'tool' }>), output: ev.output, isError: ev.isError };
      }
      break;
    }
    case 'task.started':
      next.tasks = [...c.tasks, { taskId: ev.taskId, label: ev.subagentType ?? ev.description.slice(0, 24), status: 'running', items: [] }];
      break;
    case 'task.updated':
      next.tasks = c.tasks.map((t) => (t.taskId === ev.taskId ? { ...t, status: ev.status } : t));
      break;
    case 'shell.started':
      items.push({ kind: 'shell', id: ev.id, command: ev.command });
      break;
    case 'shell.result': {
      const i = items.findIndex((x) => x.kind === 'shell' && x.id === ev.id);
      if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: 'shell' }>), output: ev.output, exitCode: ev.exitCode, truncated: ev.truncated };
      break;
    }
    case 'mcp.status': {
      const i = items.findIndex((x) => x.kind === 'mcp' && x.id === ev.id);
      const prev = i >= 0 ? (items[i] as Extract<Item, { kind: 'mcp' }>) : undefined;
      const it: Item = ev.servers
        ? { kind: 'mcp', id: ev.id, servers: ev.servers, loading: false, error: ev.error }
        : { kind: 'mcp', id: ev.id, servers: prev?.servers, loading: true, error: undefined };
      if (i >= 0) items[i] = it; else items.push(it);
      break;
    }
    case 'permission.requested':
      next.pending = [...c.pending, { reqId: ev.reqId, toolName: ev.toolName, input: ev.input }];
      break;
    case 'permission.resolved':
      next.pending = c.pending.filter((p) => p.reqId !== ev.reqId);
      break;
    case 'session.state':
      next.state = ev.state;
      break;
    case 'turn.completed':
      next.totals = ev.totals;
      next.lastTokens = { input: ev.inputTokens, output: ev.outputTokens, cacheCreation: ev.cacheCreationTokens, cacheRead: ev.cacheReadTokens };
      // resumo só deste turno (com modelo usado); mostrado no terminal, não na conversa principal (ItemView ignora 'turn')
      if (Object.keys(ev.modelUsage).length > 0) items.push({ kind: 'turn', modelUsage: ev.modelUsage, skills: turnSkills(items) });
      break;
    case 'context.usage':
      next.context = { percentage: ev.percentage, totalTokens: ev.totalTokens, maxTokens: ev.maxTokens, seq: ev.seq };
      break;
    case 'compact':
      next.compact = ev.phase === 'started'
        ? { phase: 'running', startedAt: ev.ts, seq: ev.seq }
        : { startedAt: c.compact?.startedAt ?? ev.ts, seq: ev.seq, phase: ev.phase, preTokens: ev.preTokens, postTokens: ev.postTokens, message: ev.message };
      break;
    case 'error':
      items.push({ kind: 'error', text: ev.message });
      break;
  }
  return next;
}
