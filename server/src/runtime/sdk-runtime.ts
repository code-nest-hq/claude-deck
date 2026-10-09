import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createSdkMcpServer, query, tool, type CanUseTool, type McpServerStatus, type PermissionResult, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { EFFORTS, MODELS, type EventBody, type HistoryItem, type McpAction, type McpServerView, type Model, type ModelUsage, type PlanUsage, type ShellResult, type SlashCommandInfo, type UsageTotals } from '@ccui/shared';
import { z } from 'zod';
import { visibleCommands } from '../commands';
import { HANDOFF_SYSTEM_PROMPT } from '../handoff';
import { BgTasks } from './bg-tasks';
import { mapMessage } from './events';
import { classifyHeuristic, CLASSIFY_SYSTEM_PROMPT, learnedRoute, learnRoute } from './routing';
import type { Classification, ClaudeRuntime, LiveSession, OpenOptions, SessionInfo, Transport } from './types';

const PERMISSION_TIMEOUT_MS = 10 * 60_000;
const CLASSIFY_TIMEOUT_MS = 15_000;
const HANDOFF_TIMEOUT_MS = 30_000;

type AttachBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };
const IMAGE_MIME: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

// imagem reconhecida e dentro do limite -> bloco de imagem real; qualquer outro caso -> só a referência do caminho (Claude já lê/abre com as próprias ferramentas)
async function attachmentBlocks(transport: Transport, paths: string[]): Promise<AttachBlock[]> {
  const blocks: AttachBlock[] = [];
  for (const p of paths) {
    const mime = IMAGE_MIME[path.extname(p).toLowerCase()];
    const b64 = mime ? await transport.readFile(p, MAX_ATTACH_BYTES) : null;
    blocks.push(b64 ? { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } } : { type: 'text', text: `[Arquivo anexado: ${p}]` });
  }
  return blocks;
}

// lê a resposta de texto do assistente e o custo do `result` (maxTurns: 1, ele vem logo depois); usado pelo classificador descartável
async function classifierAnswer(q: Query): Promise<{ text: string; costUsd?: number }> {
  let text = '';
  for await (const m of q) {
    if (m.type === 'assistant' && !text) {
      const b = m.message.content.find((c) => c.type === 'text');
      if (b && 'text' in b) text = b.text;
    } else if (m.type === 'result') return { text, costUsd: m.total_cost_usd };
  }
  return { text };
}

// fila assíncrona: produtor faz push, consumidor faz for-await
function channel<T>() {
  const q: T[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  return {
    push(v: T) { q.push(v); wake?.(); },
    end() { done = true; wake?.(); },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        if (q.length) { yield q.shift()!; continue; }
        if (done) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
}

const MCP_WAIT_MS = 20_000;

function mcpView(s: McpServerStatus): McpServerView {
  const c = s.config;
  const target = !c ? undefined : 'command' in c ? [c.command, ...(c.args ?? [])].join(' ') : 'url' in c ? c.url : undefined;
  return {
    name: s.name, status: s.status,
    // plugin servers report scope 'dynamic'; the terminal lists them under their own group
    scope: s.source === 'plugin' || s.name.startsWith('plugin:') ? 'plugin' : s.scope ?? s.source, transport: c?.type ?? (c ? 'stdio' : undefined), target,
    ...(s.error ? { error: s.error } : {}), ...(s.serverInfo ? { serverInfo: s.serverInfo } : {}),
    tools: (s.tools ?? []).map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}) })),
  };
}

// same data the terminal's /mcp shows; waits for servers still connecting (like the terminal's spinner)
async function mcpStatus(q: Query, action?: McpAction): Promise<{ servers: McpServerView[]; error?: string }> {
  let error: string | undefined;
  try {
    if (action?.kind === 'reconnect') await q.reconnectMcpServer(action.server);
    else if (action) await q.toggleMcpServer(action.server, action.kind === 'enable');
  } catch (e) { error = (e as Error).message; }
  const until = Date.now() + MCP_WAIT_MS;
  let list = await q.mcpServerStatus();
  while (list.some((s) => s.status === 'pending') && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500));
    list = await q.mcpServerStatus();
  }
  // hides the UI's own in-process server (Model Routing), which the terminal never shows
  const servers = list.filter((s) => s.source !== 'sdk' && s.config?.type !== 'sdk').map(mcpView);
  return error ? { servers, error } : { servers };
}

export const forbiddenModel = (m?: string) => !!m && /opus|fable/i.test(m);

class Live implements LiveSession {
  private input = channel<SDKUserMessage>();
  private out = channel<EventBody>();
  readonly events: AsyncIterable<EventBody> = this.out;
  private pending = new Map<string, (allow: boolean, why?: string, updatedInput?: Record<string, unknown>) => void>();
  // interrupt() enquanto attachmentBlocks() ainda lê o anexo (SSH lento): sem isto, o cancelamento não acha nada em
  // andamento pra abortar (q.interrupt() vira no-op) e a mensagem entra mesmo assim quando a leitura terminar depois.
  private cancelPendingSend: (() => void) | null = null;
  // task_id (interno do SDK) -> taskId (tool_use_id do Task tool) — só task_updated/task_progress precisam disto,
  // pois não trazem tool_use_id; populado quando task_started passa pelo loop em run().
  private taskIds = new Map<string, string>();
  private bg = new BgTasks();
  private stderrTail = '';
  private q: Query;
  private pump: Promise<void>;

  private canUseTool: CanUseTool = (toolName, input, { signal }) =>
    new Promise<PermissionResult>((resolve) => {
      const reqId = randomUUID();
      const done = (allow: boolean, why?: string, updatedInput?: Record<string, unknown>) => {
        if (!this.pending.delete(reqId)) return;
        clearTimeout(timer);
        this.out.push({ type: 'permission.resolved', reqId, allow });
        // updatedInput: canal usado pelo AskUserQuestion pra devolver as respostas do usuário (mesmo mecanismo de permissão)
        resolve(allow ? { behavior: 'allow', updatedInput: updatedInput ?? input } : { behavior: 'deny', message: why ?? 'Negado pelo usuário' });
      };
      const timer = setTimeout(() => done(false, 'Sem resposta em 10 min'), PERMISSION_TIMEOUT_MS);
      signal.addEventListener('abort', () => done(false, 'Cancelado'), { once: true });
      this.pending.set(reqId, done);
      this.out.push({ type: 'permission.requested', reqId, toolName, input });
    });

  constructor(o: OpenOptions, readonly resumed: boolean, private transport: Transport) {
    const routingServer = o.routing ? createSdkMcpServer({
      name: 'routing',
      tools: [tool(
        'request_model_upgrade',
        'Pede pra trocar de Haiku pra Sonnet 5 no meio da tarefa, quando ela precisar de mais raciocínio do que o esperado.',
        { reason: z.string().min(1).max(300) },
        async ({ reason }) => {
          await this.q.setModel('sonnet'); // só roda depois que canUseTool já aprovou a chamada desta tool
          return { content: [{ type: 'text', text: `Modelo trocado pra Sonnet 5. Motivo: ${reason}` }] };
        },
      )],
    }) : undefined;
    this.q = query({
      prompt: this.input,
      options: {
        cwd: o.cwd,
        ...(resumed ? { resume: o.sessionId } : { sessionId: o.sessionId }),
        model: o.model,
        effort: o.effort,
        permissionMode: o.permissionMode,
        allowDangerouslySkipPermissions: o.permissionMode === 'bypassPermissions',
        systemPrompt: o.routing
          ? { type: 'preset', preset: 'claude_code', append: 'Este projeto usa roteamento de modelo pra economizar tokens: se você estiver rodando em Haiku e perceber que a tarefa precisa de mais raciocínio (mudanças em vários arquivos, arquitetura, lógica complexa), chame a ferramenta request_model_upgrade explicando o motivo antes de continuar.' }
          : { type: 'preset', preset: 'claude_code' },
        settingSources: o.lean ? [] : ['user', 'project', 'local'],
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        ...(routingServer ? { mcpServers: { routing: routingServer } } : {}),
        spawnClaudeCodeProcess: (so) => transport.spawn(so, (s) => { this.stderrTail = (this.stderrTail + s).slice(-2000); }),
      },
    });
    this.pump = this.run();
  }

  private async run() {
    try {
      for await (const m of this.q) {
        // defesa em profundidade: a allowlist é aplicada em open(); aqui confere o modelo efetivo no init e em CADA resposta
        // (cobre qualquer caminho que troque o modelo no meio da sessão: comando, configuração, ambiente)
        const model = m.type === 'system' && m.subtype === 'init' ? m.model : m.type === 'assistant' ? m.message.model : undefined;
        if (forbiddenModel(model)) {
          this.out.push({ type: 'error', code: 'runtime', message: `modelo não permitido: ${model}. A sessão foi encerrada.` });
          this.q.close();
          break;
        }
        if (m.type === 'system' && m.subtype === 'task_started' && m.tool_use_id) this.taskIds.set(m.task_id, m.tool_use_id);
        if (m.type === 'system' && m.subtype === 'task_updated') {
          const taskId = this.taskIds.get(m.task_id);
          if (taskId && m.patch.status) this.out.push({ type: 'task.updated', taskId, status: m.patch.status });
          continue; // mapMessage não trata task_updated (não tem tool_use_id pra tagueá-lo sozinho)
        }
        if (this.bg.apply(m)) this.out.push({ type: 'bg.tasks', tasks: this.bg.list() });
        for (const b of mapMessage(m)) {
          if (b.type === 'tool.result') this.bg.toolResult(b.toolUseId, b.output);
          this.out.push(b);
        }
        // after each turn: context occupancy for the auto-compact check ('summary' = last response's usage, no token-count calls)
        if (m.type === 'result') {
          const u = await this.q.getContextUsage({ detail: 'summary' }).catch(() => null);
          if (u) this.out.push({ type: 'context.usage', percentage: u.percentage, totalTokens: u.totalTokens, maxTokens: u.rawMaxTokens });
        }
      }
    } catch (e) {
      this.out.push({ type: 'error', code: 'exit', message: `${(e as Error).message}\n${this.stderrTail}`.trim() });
    } finally {
      for (const done of [...this.pending.values()]) done(false, 'Sessão encerrada');
      if (this.bg.stopAll()) this.out.push({ type: 'bg.tasks', tasks: this.bg.list() });
      this.out.end();
    }
  }

  send(text: string, attachments: string[] = []) {
    if (attachments.length === 0) {
      this.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
      return;
    }
    let cancelled = false;
    this.cancelPendingSend = () => { cancelled = true; };
    void attachmentBlocks(this.transport, attachments).then((blocks) => {
      if (cancelled) return; // usuário pediu interrupt() antes da leitura terminar: descarta, não envia
      const content: AttachBlock[] = [{ type: 'text', text }, ...blocks];
      this.input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
    });
  }
  async interrupt() {
    this.cancelPendingSend?.();
    this.cancelPendingSend = null;
    await this.q.interrupt();
  }
  async setModel(model: Model) { await this.q.setModel(model); }
  mcp(action?: McpAction) { return mcpStatus(this.q, action); }
  async reload() {
    await this.q.reloadSkills();
    const r = await this.q.reloadPlugins(); // applied even when it invalidates the prompt cache: the user asked for it
    return { plugins: r.plugins.length, errors: r.error_count };
  }
  async bgOutput(taskId: string) {
    const f = this.bg.outputFile(taskId);
    return f ? this.transport.tailFile(f, BG_OUTPUT_BYTES) : null;
  }
  async stopTask(taskId: string) { await this.q.stopTask(taskId); }
  answerPermission(reqId: string, allow: boolean, updatedInput?: Record<string, unknown>) { this.pending.get(reqId)?.(allow, undefined, updatedInput); }

  // fecha stdin (EOF) => o claude sai sozinho; se não sair em 2 s, encerra à força
  async close() {
    this.input.end();
    const t = setTimeout(() => this.q.close(), 2000);
    await this.pump;
    clearTimeout(t);
  }
}

const IDLE_WAIT_MS = 30_000;
const BG_OUTPUT_BYTES = 64 * 1024; // tail shown in the background task modal
const COMMANDS_TIMEOUT_MS = 25_000;
const USAGE_TIMEOUT_MS = 45_000;

// Plan usage (the terminal's /usage) for the account in `env`: short-lived process, control channel only, no tokens spent.
// Spawned by the SDK itself (not a Transport) so it reads the given profile's login, not the active one.
// ponytail: experimental SDK API; if it's renamed, this is the only call site
export async function planUsage(env: NodeJS.ProcessEnv): Promise<PlanUsage> {
  const input = channel<SDKUserMessage>();
  const q = query({ prompt: input, options: { model: 'haiku', persistSession: false, settingSources: [], env } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout reading plan usage')), USAGE_TIMEOUT_MS); });
    const { session: _session, ...u } = await Promise.race([q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(), timeout]);
    return { ...u, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
    input.end();
    q.close();
  }
}

export class SdkRuntime implements ClaudeRuntime {
  constructor(private transport: Transport) {}

  listSessions(cwd: string): Promise<SessionInfo[]> { return this.transport.listSessions(cwd); }
  history(sessionId: string, cwd: string): Promise<HistoryItem[]> { return this.transport.history(sessionId, cwd); }

  shell(cwd: string, command: string): Promise<ShellResult> { return this.transport.shell(cwd, command); }
  usage(sessionId: string, cwd: string): Promise<{ totals: UsageTotals; modelUsage: Record<string, ModelUsage> } | null> { return this.transport.usage(sessionId, cwd); }

  async classify(cwd: string, text: string): Promise<Classification> {
    const t0 = Date.now();
    const heuristic = classifyHeuristic(text);
    const learnedModel = heuristic ? null : learnedRoute(text);
    const known = heuristic ?? learnedModel;
    if (known) return { model: known, source: heuristic ? 'heuristic' : 'learned', durationMs: Date.now() - t0 };
    const r = await this.classifyViaHaiku(cwd, text);
    if (!r.model) return { model: 'sonnet', source: 'fallback', costUsd: r.costUsd, durationMs: Date.now() - t0 }; // failure/timeout: bigger model, and nothing learned from it
    learnRoute(text, r.model);
    return { model: r.model, source: 'haiku', costUsd: r.costUsd, durationMs: Date.now() - t0 };
  }

  /** one throwaway Haiku turn (no session persisted, no settings, no tools); throws on failure or timeout */
  private async haikuOnce(cwd: string, system: string, text: string, limit: number, timeoutMs: number): Promise<{ text: string; costUsd?: number }> {
    const input = channel<SDKUserMessage>();
    const q = query({
      prompt: input,
      options: {
        cwd, model: 'haiku', persistSession: false, maxTurns: 1,
        systemPrompt: { type: 'custom', prompt: system },
        settingSources: [],
        spawnClaudeCodeProcess: (so) => this.transport.spawn(so, () => {}),
      },
    });
    input.push({ type: 'user', message: { role: 'user', content: text.slice(0, limit) }, parent_tool_use_id: null });
    input.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); });
      return await Promise.race([classifierAnswer(q), timeout]);
    } finally {
      clearTimeout(timer);
      q.close();
    }
  }

  private async classifyViaHaiku(cwd: string, text: string): Promise<{ model: Model | null; costUsd?: number }> {
    try {
      const { text: answer, costUsd } = await this.haikuOnce(cwd, CLASSIFY_SYSTEM_PROMPT, text, 2000, CLASSIFY_TIMEOUT_MS);
      if (!answer.trim()) return { model: null, costUsd };
      return { model: /\bhaiku\b/i.test(answer) ? 'haiku' : 'sonnet', costUsd };
    } catch {
      return { model: null }; // failure: the caller falls back to Sonnet, never to the cheap model
    }
  }

  async handoffNotes(cwd: string, text: string): Promise<{ text: string; costUsd?: number }> {
    return this.haikuOnce(cwd, HANDOFF_SYSTEM_PROMPT, text, 16_000, HANDOFF_TIMEOUT_MS);
  }

  // Sobe um processo sem enviar mensagem: o SDK responde a lista de comandos pelo canal de controle (sem custo de tokens).
  async commands(cwd: string, lean: boolean): Promise<SlashCommandInfo[]> {
    const input = channel<SDKUserMessage>();
    const q = query({
      prompt: input,
      options: {
        cwd, model: 'haiku', persistSession: false,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: lean ? [] : ['user', 'project', 'local'],
        spawnClaudeCodeProcess: (so) => this.transport.spawn(so, () => {}),
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout ao listar comandos')), COMMANDS_TIMEOUT_MS); });
      return visibleCommands(await Promise.race([q.supportedCommands(), timeout]));
    } finally {
      clearTimeout(timer);
      input.end();
      q.close();
    }
  }

  async mcp(cwd: string, lean: boolean, action?: McpAction): Promise<{ servers: McpServerView[]; error?: string }> {
    const input = channel<SDKUserMessage>();
    const q = query({
      prompt: input,
      options: {
        cwd, model: 'haiku', persistSession: false,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: lean ? [] : ['user', 'project', 'local'],
        spawnClaudeCodeProcess: (so) => this.transport.spawn(so, () => {}),
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout reading MCP status')), COMMANDS_TIMEOUT_MS + MCP_WAIT_MS); });
      return await Promise.race([mcpStatus(q, action), timeout]);
    } finally {
      clearTimeout(timer);
      input.end();
      q.close();
    }
  }

  async settle(sessionId: string, _cwd?: string): Promise<void> {
    await this.transport.waitSessionIdle(sessionId, IDLE_WAIT_MS).catch(() => {});
  }

  async open(o: OpenOptions): Promise<LiveSession> {
    if (!MODELS.includes(o.model) || !EFFORTS.includes(o.effort)) throw new Error('modelo/effort não permitido');
    if (o.permissionMode !== 'default' && o.permissionMode !== 'plan' && o.permissionMode !== 'bypassPermissions') throw new Error('permissionMode não permitido');
    const exists = await this.transport.sessionExists(o.sessionId, o.cwd);
    // remoto: um claude antigo pode estar terminando o turno; dois escritores no mesmo jsonl corromperiam o histórico
    if (exists) await this.transport.waitSessionIdle(o.sessionId, IDLE_WAIT_MS);
    return new Live(o, exists, this.transport);
  }
}
