import { randomUUID } from 'node:crypto';
import { ZERO_TOTALS, type BgTask, type ClaudeEvent, type EventBody, type McpAction, type Model, type ModelUsage, type PendingPermission, type ServerMsg, type SessionState, type UsageTotals } from '@ccui/shared';
import { logError } from './logs';
import type { ClaudeRuntime, LiveSession, OpenOptions } from './runtime/types';

const BUFFER = 2000;
const INTERRUPT_GRACE_MS = 5000;

export interface Client { send(m: ServerMsg): void; sessions: Set<string> }
export type OpenSpec = Omit<OpenOptions, 'sessionId'>;
/** who a session belongs to, for the error log */
export interface SessionLabel { projectId?: string; projectName?: string; sessionName?: string; connectionId?: string }

interface Entry {
  seq: number;
  buffer: ClaudeEvent[];
  state: SessionState;
  live: LiveSession | null;
  clients: Set<Client>;
  pending: Map<string, PendingPermission>;
  shellRunning: boolean;
  mcpRunning: boolean;
  totals: UsageTotals | null; // null até a 1ª leitura do jsonl ou o 1º turno desta execução
  // ponytail: snapshot cumulativo por-modelo só desta execução (não lido do jsonl); no 1º turno após reabrir a sessão
  // o delta calculado é o acumulado inteiro, não só o turno — aceitável, é só o resumo exibido no terminal
  prevModelUsage: Record<string, ModelUsage> | null;
  bgTasks: BgTask[]; // last bg.tasks list, sent in the snapshot
}

// the debug-relevant part of an event for the log's recent-events trail (no streamed text, no big tool payloads)
function summary(ev: ClaudeEvent): Record<string, unknown> {
  const cut = (v: unknown, n = 300) => (typeof v === 'string' ? v.slice(0, n) : JSON.stringify(v ?? null).slice(0, n));
  switch (ev.type) {
    case 'session.state': return { state: ev.state };
    case 'user.message': case 'message.completed': return { text: cut(ev.text) };
    case 'model.routed': return { model: ev.model };
    case 'tool.started': return { name: ev.name, input: cut(ev.input) };
    case 'tool.result': return { toolUseId: ev.toolUseId, isError: ev.isError, output: cut(ev.output) };
    case 'error': return { code: ev.code, message: cut(ev.message, 1000), errorId: ev.errorId };
    case 'turn.completed': return { costUsd: ev.totals.costUsd };
    case 'context.usage': return { percentage: ev.percentage };
    case 'compact': return { phase: ev.phase };
    default: return {};
  }
}

// cumulativo atual menos o snapshot anterior, por modelo; negativo vira 0 (defensivo)
function diffModelUsage(prev: Record<string, ModelUsage>, cur: Record<string, ModelUsage>): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = {};
  for (const [model, c] of Object.entries(cur)) {
    const p = prev[model];
    const d: ModelUsage = {
      input: Math.max(0, c.input - (p?.input ?? 0)),
      output: Math.max(0, c.output - (p?.output ?? 0)),
      cacheCreation: Math.max(0, c.cacheCreation - (p?.cacheCreation ?? 0)),
      cacheRead: Math.max(0, c.cacheRead - (p?.cacheRead ?? 0)),
      costUsd: Math.max(0, c.costUsd - (p?.costUsd ?? 0)),
    };
    if (d.input || d.output || d.cacheCreation || d.cacheRead || d.costUsd) out[model] = d;
  }
  return out;
}

export class SessionHub {
  private entries = new Map<string, Entry>();
  constructor(
    private runtimeFor: (sessionId: string) => ClaudeRuntime,
    private spec: (sessionId: string) => OpenSpec,
    private label: (sessionId: string) => SessionLabel = () => ({}),
  ) {}

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { seq: 0, buffer: [], state: 'idle', live: null, clients: new Set(), pending: new Map(), shellRunning: false, mcpRunning: false, totals: null, prevModelUsage: null, bgTasks: [] };
      this.entries.set(id, e);
    }
    return e;
  }

  isLive(id: string) { return !!this.entries.get(id)?.live; }

  private async snapshot(c: Client, id: string, e: Entry) {
    const rt = this.runtimeFor(id);
    const cwd = this.spec(id).cwd;
    const [history, stored] = await Promise.all([rt.history(id, cwd), e.totals ? null : rt.usage(id, cwd).catch(() => null)]);
    if (!e.totals && stored) {
      e.totals = stored.totals; // sessão antiga/backend reiniciado: parte do acumulado gravado no jsonl
      e.prevModelUsage = stored.modelUsage; // idem por-modelo, pro 1º turno desta execução calcular o delta certo (só o turno, não a sessão)
    }
    // estado lido DEPOIS do await: eventos emitidos durante a leitura já foram enviados a `c` e o cliente os ignora até hidratar
    c.send({ type: 'snapshot', sessionId: id, history, state: e.state, lastSeq: e.seq, totals: e.totals ?? ZERO_TOTALS, pending: [...e.pending.values()], bgTasks: e.bgTasks });
  }

  async attach(c: Client, id: string, afterSeq?: number) {
    this.spec(id); // lança se a sessão for desconhecida
    const e = this.entry(id);
    e.clients.add(c);
    c.sessions.add(id);
    const first = e.buffer[0]?.seq;
    const canReplay = afterSeq !== undefined && afterSeq <= e.seq && (afterSeq === e.seq || (first !== undefined && first <= afterSeq + 1));
    if (canReplay) {
      for (const ev of e.buffer) if (ev.seq > afterSeq!) c.send({ type: 'event', event: ev });
      return;
    }
    await this.snapshot(c, id, e);
  }

  detach(c: Client, id: string) { this.entries.get(id)?.clients.delete(c); c.sessions.delete(id); }
  drop(c: Client) { for (const id of c.sessions) this.entries.get(id)?.clients.delete(c); c.sessions.clear(); }

  async send(id: string, text: string, attachments: string[] = []): Promise<'ok' | 'busy'> {
    const spec = this.spec(id);
    const e = this.entry(id);
    if (e.state === 'running' || e.state === 'awaiting_permission') return 'busy';
    this.setState(id, e, 'running'); // reserva antes do await para não abrir dois processos
    // classify BEFORE taking the process: the process may exit during the (up to 15 s) classifier call,
    // so nothing may hold on to e.live across that await
    // `/compact` keeps the session's current model: no classifier call, and the summary isn't downgraded to Haiku
    let model: Model | undefined;
    if (spec.routing && !/^\/compact(\s|$)/.test(text.trim())) {
      this.emit(id, e, { type: 'routing.started' });
      model = await this.runtimeFor(id).classify(spec.cwd, text).catch(() => 'sonnet' as const);
    }
    if (!e.live) {
      try {
        e.live = await this.runtimeFor(id).open({ ...spec, sessionId: id });
      } catch (err) {
        this.emit(id, e, { type: 'error', code: 'runtime', message: (err as Error).message });
        this.setState(id, e, 'idle');
        return 'ok';
      }
      void this.pump(id, e, e.live);
    }
    const live = e.live;
    if (model) {
      await live.setModel(model).catch(() => {});
      this.emit(id, e, { type: 'model.routed', model });
    }
    this.emit(id, e, { type: 'user.message', text });
    live.send(text, attachments);
    return 'ok';
  }

  // modo shell (`!cmd`): roda o comando do usuário e publica início/resultado como eventos (todos os clientes veem; entra no replay)
  async shell(id: string, command: string): Promise<'ok' | 'busy'> {
    const spec = this.spec(id);
    const e = this.entry(id);
    if (e.shellRunning) return 'busy';
    e.shellRunning = true;
    const sid = randomUUID();
    this.emit(id, e, { type: 'shell.started', id: sid, command });
    try {
      this.emit(id, e, { type: 'shell.result', id: sid, ...(await this.runtimeFor(id).shell(spec.cwd, command)) });
    } catch (err) {
      this.emit(id, e, { type: 'shell.result', id: sid, output: (err as Error).message, exitCode: null, truncated: false });
    } finally { e.shellRunning = false; }
    return 'ok';
  }

  // `/mcp`: panel as an event (like shell); uses the live process when there is one, otherwise a short-lived one
  async mcp(id: string, cardId?: string, action?: McpAction): Promise<'ok' | 'busy'> {
    const spec = this.spec(id);
    const e = this.entry(id);
    if (e.mcpRunning) return 'busy';
    e.mcpRunning = true;
    const mid = cardId ?? randomUUID();
    this.emit(id, e, { type: 'mcp.status', id: mid });
    try {
      const r = e.live ? await e.live.mcp(action) : await this.runtimeFor(id).mcp(spec.cwd, spec.lean, action);
      this.emit(id, e, { type: 'mcp.status', id: mid, ...r });
    } catch (err) {
      this.emit(id, e, { type: 'mcp.status', id: mid, servers: [], error: (err as Error).message });
    } finally { e.mcpRunning = false; }
    return 'ok';
  }

  // "Refresh": reloads skills/plugins into the open process; with none open the next message already starts fresh (null).
  // Refused mid-turn so the tool list doesn't change under a running turn.
  async reload(id: string): Promise<{ plugins: number; errors: number } | null | 'busy'> {
    this.spec(id);
    const e = this.entries.get(id);
    if (!e?.live) return null;
    if (e.state === 'running' || e.state === 'awaiting_permission') return 'busy';
    return e.live.reload();
  }

  // background task modal: null = no live process (the tasks died with it)
  async bgOutput(id: string, taskId: string) {
    this.spec(id);
    const live = this.entries.get(id)?.live;
    return live ? { live: true, output: await live.bgOutput(taskId) } : { live: false, output: null };
  }
  async stopTask(id: string, taskId: string) {
    this.spec(id);
    const live = this.entries.get(id)?.live;
    if (!live) return false;
    await live.stopTask(taskId);
    return true;
  }

  private async pump(id: string, e: Entry, live: LiveSession) {
    let crash: EventBody | null = null;
    for await (const b of live.events) {
      const ev = this.emit(id, e, b);
      if (ev.type === 'error' && ev.code === 'exit') crash = ev;
    }
    e.live = null;
    e.pending.clear();
    this.setState(id, e, 'exited');
    if (crash) void this.recover(id, e, crash);
  }

  // queda de SSH/crash: o claude remoto termina o turno sozinho; espera ele sair e reenvia o histórico completo
  // the snapshot rebuilds the chat from the jsonl, which never has the crash: the error (same errorId, not logged again) is re-sent after it
  private async recover(id: string, e: Entry, crash: EventBody) {
    try {
      await this.runtimeFor(id).settle(id, this.spec(id).cwd);
      for (const c of e.clients) await this.snapshot(c, id, e);
      this.emit(id, e, crash);
    } catch { /* conexão ainda fora: o usuário reabre a sessão depois */ }
  }

  async interrupt(id: string) {
    const e = this.entries.get(id);
    const live = e?.live;
    if (!e || !live) return;
    await live.interrupt().catch(() => {});
    // sem sair de running em 5 s => encerra o processo (a sessão continua retomável)
    setTimeout(() => {
      if (e.live === live && (e.state === 'running' || e.state === 'awaiting_permission')) void live.close();
    }, INTERRUPT_GRACE_MS);
  }

  answerPermission(id: string, reqId: string, allow: boolean, updatedInput?: Record<string, unknown>) {
    this.entries.get(id)?.live?.answerPermission(reqId, allow, updatedInput);
  }

  async shutdown() {
    await Promise.all([...this.entries.values()].map((e) => e.live?.close()));
  }

  // every session error goes to the daily log once (the event carries its errorId from then on)
  private logSessionError(id: string, e: Entry, body: Extract<EventBody, { type: 'error' }>): string {
    let spec: OpenSpec | undefined;
    try { spec = this.spec(id); } catch { /* unknown session */ }
    const recent = e.buffer.filter((x) => x.type !== 'message.delta').slice(-20)
      .map((x) => ({ seq: x.seq, ts: new Date(x.ts).toISOString(), type: x.type, ...summary(x) }));
    return logError({
      level: 'error', source: 'session', code: body.code, message: body.message, sessionId: id, ...this.label(id),
      context: { spec, state: e.state, live: !!e.live, pendingPermissions: e.pending.size, seq: e.seq, totals: e.totals, recentEvents: recent },
    });
  }

  private emit(id: string, e: Entry, body: EventBody): ClaudeEvent {
    if (body.type === 'error' && !body.errorId) body = { ...body, errorId: this.logSessionError(id, e, body) };
    if (body.type === 'turn.completed') {
      const cumulative = body.modelUsage;
      body = { ...body, modelUsage: diffModelUsage(e.prevModelUsage ?? {}, cumulative) };
      e.prevModelUsage = cumulative;
    }
    const ev = { ...body, sessionId: id, seq: ++e.seq, ts: Date.now() } as ClaudeEvent;
    e.buffer.push(ev);
    if (e.buffer.length > BUFFER) e.buffer.shift();
    for (const c of e.clients) c.send({ type: 'event', event: ev });
    switch (body.type) {
      case 'permission.requested':
        e.pending.set(body.reqId, { reqId: body.reqId, toolName: body.toolName, input: body.input });
        this.setState(id, e, 'awaiting_permission');
        break;
      case 'permission.resolved':
        e.pending.delete(body.reqId);
        if (e.pending.size === 0 && e.state === 'awaiting_permission') this.setState(id, e, 'running');
        break;
      // a turn the CLI starts by itself (a background task finished: <task-notification>) has no send(): mark it running here
      case 'message.delta':
      case 'message.completed':
      case 'tool.started':
        if (e.state === 'idle' && e.live) this.setState(id, e, 'running');
        break;
      case 'bg.tasks':
        e.bgTasks = body.tasks;
        break;
      case 'turn.completed':
        e.totals = body.totals;
        this.setState(id, e, 'idle');
        break;
    }
    return ev;
  }

  private setState(id: string, e: Entry, s: SessionState) {
    if (e.state === s) return;
    e.state = s;
    this.emit(id, e, { type: 'session.state', state: s });
  }
}
