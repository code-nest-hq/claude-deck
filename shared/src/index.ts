import { z } from 'zod';

export const MODELS = ['haiku', 'sonnet'] as const;
export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Model = (typeof MODELS)[number];
export type Effort = (typeof EFFORTS)[number];
export const modelSchema = z.enum(MODELS);
export const effortSchema = z.enum(EFFORTS);
export const uuidSchema = z.string().uuid();

export interface Connection { id: string; kind: 'local' | 'ssh'; target?: string; label: string; claudePath?: string }
export type ConnStatus = 'up' | 'down' | 'reconnecting';
export interface Project { id: string; name: string; connectionId: string; path: string; lean: boolean; routing?: boolean; bypass?: boolean; autoCompact?: boolean; model?: Model; effort?: Effort; /** accent hex (#rrggbb) shown on the project card */ color?: string; /** shown in the always-visible pinned bar */ pinned?: boolean }
export interface SessionMeta {
  sessionId: string; projectId: string; name?: string; model?: Model; effort?: Effort; routing?: boolean;
  tags?: string[]; favorite?: boolean; archived?: boolean; createdAt: number; lastUsedAt: number;
  /** session this one was started from via "new session with handoff" */ handoffFrom?: string;
}
export interface Config {
  version: 1;
  lastConnectionId: string | null;
  defaults: { model: Model; effort: Effort };
  connections: Connection[];
  /** extra Claude accounts, each with its own CLAUDE_CONFIG_DIR; the implicit 'default' profile is the user's own ~/.claude */
  profiles?: Array<{ id: string; name: string }>;
  /** profile used by new local sessions; absent = 'default' */
  activeProfile?: string;
}
/** what `claude auth status --json` + the profile's `.claude.json` (oauthAccount) + `.credentials.json` metadata expose; never tokens */
export interface ProfileView {
  id: string; name: string; active: boolean;
  status: Record<string, unknown> | null;
  account: Record<string, unknown> | null;
  credentials: { expiresAt?: number; refreshTokenExpiresAt?: number; scopes?: string[]; subscriptionType?: string; rateLimitTier?: string } | null;
  login: { running: boolean; url?: string; output: string } | null;
}
/** Status modal: the session's meta plus the effective settings its process opens with (session > project > global defaults) */
export interface SessionStatus {
  meta: SessionMeta; live: boolean;
  model: Model; effort: Effort; routing: boolean; lean: boolean; permissionMode: 'default' | 'plan' | 'bypassPermissions';
}
/** `GET .../handoff`: the prompt for a fresh session that continues this one; `enriched` only when ?enrich=1 and the Haiku call worked */
export interface HandoffResult { text: string; enriched?: boolean; costUsd?: number; error?: string }
export interface SessionRow { sessionId: string; name: string; lastModified: number; live: boolean; tags: string[]; favorite: boolean; archived: boolean }
export interface SlashCommandInfo { name: string; description: string; argumentHint: string; aliases?: string[]; builtin: boolean }
export interface GitInfo { branch: string | null; ahead: number; behind: number; changed: number; untracked: number }
export interface DirEntry { name: string; isDir: boolean }
export const LOCAL: Connection = { id: 'local', kind: 'local', label: 'Local' };

const name = (max: number) => z.string().trim().min(1).max(max);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const createProjectBody = z.object({ name: name(80), path: z.string().min(1).max(1024), lean: z.boolean().default(false), connectionId: z.string().min(1).default('local'), color: colorSchema.optional() });
export const createConnectionBody = z.object({ target: z.string().min(1).max(255), label: name(80).optional(), claudePath: z.string().max(255).optional() });
export const patchProjectBody = z.object({ name: name(80).optional(), lean: z.boolean().optional(), routing: z.boolean().optional(), bypass: z.boolean().optional(), autoCompact: z.boolean().optional(), model: modelSchema.optional(), effort: effortSchema.optional(), color: colorSchema.optional(), pinned: z.boolean().optional() });
export const patchConfigBody = z.object({ model: modelSchema.optional(), effort: effortSchema.optional() })
  .refine((b) => b.model !== undefined || b.effort !== undefined, { message: 'nada para alterar' });
/** plan rate-limit window: utilization 0-100, resets_at ISO 8601 */
export interface UsageWindow { utilization: number | null; resets_at: string | null; locked_reason?: string | null }
type Share = Array<{ name: string; pct: number }>;
export interface UsageBreakdown {
  request_count: number; session_count: number;
  behaviors: Array<{ key: string; pct: number; count: number }>;
  agents: Share; skills: Share; plugins: Share; mcp_servers: Share;
}
/** the terminal's /usage data (SDK get_usage, minus the per-session totals) */
export interface PlanUsage {
  subscription_type: string | null;
  rate_limits_available: boolean;
  rate_limits: {
    five_hour?: UsageWindow | null; seven_day?: UsageWindow | null; seven_day_oauth_apps?: UsageWindow | null;
    seven_day_opus?: UsageWindow | null; seven_day_sonnet?: UsageWindow | null;
    model_scoped?: Array<UsageWindow & { display_name: string }>;
    extra_usage?: { is_enabled: boolean; monthly_limit: number | null; used_credits: number | null; utilization: number | null; currency?: string | null } | null;
    // undocumented fields the endpoint also returns today (passed through as-is, all optional)
    limits?: Array<{ kind: string; group: string; percent: number | null; severity: string | null; resets_at: string | null; is_active?: boolean }>;
    seven_day_breakdown?: { window_started_at?: string | null; rows: Array<{ key: string; display_name: string; percent: number }> } | null;
    spend?: { used?: { amount_minor: number; currency: string; exponent: number } | null; limit?: { amount_minor: number; currency: string; exponent: number } | null; percent?: number | null; enabled?: boolean; disclaimer?: string | null } | null;
  } | null;
  behaviors: { day: UsageBreakdown; week: UsageBreakdown } | null;
  fetchedAt: number;
}
export const createProfileBody =z.object({ name: name(80) });
export const loginCodeBody = z.object({ code: z.string().trim().min(1).max(2048) });
/** where the user started a handoff from (recorded for the token audit) */
export const HANDOFF_TRIGGERS = ['zone-badge', 'auto-compact-modal', 'cold-cache'] as const;
export type HandoffTrigger = (typeof HANDOFF_TRIGGERS)[number];
export const createSessionBody =z.object({ name: name(120), model: modelSchema.optional(), effort: effortSchema.optional(), routing: z.boolean().optional(), handoffFrom: uuidSchema.optional(), trigger: z.enum(HANDOFF_TRIGGERS).optional() });
const tag = z.string().trim().toLowerCase().min(1).max(30).regex(/^[\p{L}\p{N}_-]+$/u);
export const patchSessionBody = z.object({
  projectId: z.string().min(1),
  name: name(120).optional(),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  tags: z.array(tag).max(10).optional(),
}).refine((b) => b.name !== undefined || b.favorite !== undefined || b.archived !== undefined || b.tags !== undefined, { message: 'nada para alterar' });
export const lastConnectionBody = z.object({ connectionId: z.string().min(1) });

// ---- eventos (contrato único entre backend e React) ----
export type SessionState = 'idle' | 'running' | 'awaiting_permission' | 'exited';
export interface PendingPermission { reqId: string; toolName: string; input: unknown; /** rules "Always allow" would add to permissions.allow; absent when the SDK offered no suggestion */ alwaysRules?: string[] }
// a task Claude left running in the background (Bash run_in_background, backgrounded subagent, monitor...); taskId = SDK task_id
export interface BgTask {
  taskId: string; toolUseId?: string; kind: string; description: string;
  status: 'running' | 'completed' | 'failed' | 'stopped'; startedAt: number; endedAt?: number; summary?: string;
}
export type EventBody =
  | { type: 'session.state'; state: SessionState }
  | { type: 'user.message'; text: string }
  | { type: 'message.delta'; text: string }
  | { type: 'message.completed'; text: string }
  // live token meter while a turn runs: one API message at a time ('start' carries its input side, 'end' the exact output);
  // 'turn.progress' = characters streamed since (thinking / tool input), used to estimate output between the two
  | { type: 'turn.usage'; phase: 'start' | 'end'; input?: number; output: number; cacheCreation?: number; cacheRead?: number }
  | { type: 'turn.progress'; chars: number }
  | { type: 'tool.started'; toolUseId: string; name: string; input: unknown; taskId?: string }
  | { type: 'tool.result'; toolUseId: string; output: string; isError: boolean; taskId?: string }
  // subagente (Task tool): taskId = tool_use_id do Task tool. Só 1º nível vira aba no cliente.
  | { type: 'task.started'; taskId: string; subagentType?: string; description: string }
  | { type: 'task.updated'; taskId: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused' }
  // full list of the session's background tasks (REPLACE semantics); running ones become 'stopped' when the process exits
  | { type: 'bg.tasks'; tasks: BgTask[] }
  | { type: 'routing.started' }
  | { type: 'model.routed'; model: Model }
  | ({ type: 'permission.requested' } & PendingPermission)
  | { type: 'permission.resolved'; reqId: string; allow: boolean }
  // modelUsage: no evento entregue ao cliente é o gasto SÓ deste turno, por modelo (delta calculado em hub.ts)
  // subagent = this turn's subagent share (estimated at RATES: the SDK result has no per-agent cost); set by the hub
  | { type: 'turn.completed'; totals: UsageTotals; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; modelUsage: Record<string, ModelUsage>; subagent?: { costUsd: number; tokens: number } }
  // one subagent API message's usage; consumed by the hub (summed into turn.completed.subagent), never sent to clients
  | { type: 'subagent.usage'; messageId: string; model: string; input: number; output: number; cacheCreation: number; cacheRead: number }
  // context window occupancy after a turn (SDK getContextUsage 'summary', no token cost); percentage is of the autocompact window
  // plan mode on/off for the session (UI toggle, or the runtime leaving it when the user approves ExitPlanMode)
  | { type: 'plan.mode'; on: boolean }
  | { type: 'context.usage'; percentage: number; totalTokens: number; maxTokens: number }
  // what fills the context before the conversation does (system prompt, tools, CLAUDE.md, skills, MCP); sent once per live process
  | { type: 'context.baseline'; baseline: ContextBaseline }
  // `/compact` (manual or the CLI's own auto-compact): no real progress is reported, only start and end
  | { type: 'compact'; phase: 'started' | 'done' | 'failed'; preTokens?: number; postTokens?: number; message?: string }
  | { type: 'shell.started'; id: string; command: string }
  | ({ type: 'shell.result'; id: string } & ShellResult)
  // `/mcp` panel: servers absent = still loading (the client keeps the previous list while it refreshes)
  | { type: 'mcp.status'; id: string; servers?: McpServerView[]; error?: string }
  // errorId: key of the entry in the daily error log (Logs page), shown next to the error so it can be looked up
  | { type: 'error'; code: 'runtime' | 'exit'; message: string; errorId?: string };
export type ClaudeEvent = EventBody & { sessionId: string; seq: number; ts: number };
export interface HistoryItem { role: 'user' | 'assistant'; text: string; ts?: number }
// acumulado da sessão (todas as execuções, inclusive antes de um resume); custo é ESTIMATIVA a preço de API (não é cobrança em plano de assinatura)
export interface UsageTotals { costUsd: number; input: number; output: number; cacheCreation: number; cacheRead: number }
export interface ModelUsage { input: number; output: number; cacheCreation: number; cacheRead: number; costUsd: number }
export interface ShellResult { output: string; exitCode: number | null; truncated: boolean }
export type McpStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
// what the terminal's /mcp shows; never env/headers (may carry secrets)
export interface McpServerView {
  name: string; status: McpStatus; scope?: string; transport?: string; target?: string; error?: string;
  serverInfo?: { name: string; version: string }; authUrl?: string; tools: Array<{ name: string; description?: string }>;
}
export const mcpActionSchema = z.object({
  kind: z.enum(['reconnect', 'enable', 'disable', 'auth', 'authCallback', 'clearAuth']),
  server: z.string().min(1).max(200),
  redirectUri: z.string().max(500).optional(), // 'auth' only: set by the server (the Deck's own callback route), whatever the client sends is overwritten
  callbackUrl: z.string().max(4000).optional(), // only for 'authCallback': the URL the browser was redirected to after sign-in
});
export type McpAction = z.infer<typeof mcpActionSchema>;

// `/plugin` panel: the terminal's `claude plugin …` run on the project's machine (local or SSH)
export interface PluginView {
  id: string; name: string; marketplace: string; version?: string; scope?: string; projectPath?: string; enabled: boolean;
  description?: string; installedAt?: string; lastUpdated?: string; mcpServers: string[];
}
export interface PluginAvailable { id: string; name: string; marketplace: string; description?: string; category?: string }
export interface MarketplaceView { name: string; source: string; target?: string }
export interface PluginsView { installed: PluginView[]; available: PluginAvailable[]; marketplaces: MarketplaceView[] }
export interface PluginActionResult { ok: boolean; output: string; view?: PluginsView; error?: string }
const pluginIdSchema = z.string().regex(/^(?!-)[\w.-]+(@[\w.-]+)?$/).max(200);
const pluginScopeSchema = z.enum(['user', 'project', 'local']).optional();
// marketplace source: URL, GitHub `owner/repo` or path; never starts with `-` (option injection) and has no whitespace/control chars
const marketplaceSourceSchema = z.string().trim().min(1).max(500).regex(/^[^\s\x00-\x1f-][^\s\x00-\x1f]*$/);
export const pluginActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['install', 'uninstall', 'enable', 'disable', 'update']), plugin: pluginIdSchema, scope: pluginScopeSchema }),
  z.object({ kind: z.literal('marketplace.add'), source: marketplaceSourceSchema, scope: pluginScopeSchema }),
  z.object({ kind: z.literal('marketplace.remove'), name: pluginIdSchema }),
  z.object({ kind: z.literal('marketplace.update'), name: pluginIdSchema.optional() }),
]);
export type PluginAction = z.infer<typeof pluginActionSchema>;
export const ZERO_TOTALS: UsageTotals = { costUsd: 0, input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

// ---- error log: one JSON line per entry in <data dir>/logs/YYYY-MM-DD.jsonl (local date) ----
export interface LogEntry {
  id: string; ts: string; level: 'error' | 'warn';
  /** session = event of a Claude session; ws/http = request handling; process = uncaught exception in the backend */
  source: 'session' | 'ws' | 'http' | 'process';
  code?: string; message: string; stack?: string;
  sessionId?: string; projectId?: string; projectName?: string; sessionName?: string;
  /** everything else useful to debug later (open options, session state, recent events, request, versions) */
  context?: Record<string, unknown>;
}
export const LOG_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- protocolo WebSocket ----
export const ClientMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('attach'), sessionId: uuidSchema, projectId: z.string().min(1), afterSeq: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('detach'), sessionId: uuidSchema }),
  z.object({ type: z.literal('send'), sessionId: uuidSchema, text: z.string().min(1).max(200_000), attachments: z.array(z.string()).max(10).optional(), origin: z.literal('auto-compact').optional() }),
  // the user dismissed the auto-compact prompt (only the web knows); recorded in the session log
  z.object({ type: z.literal('compact.declined'), sessionId: uuidSchema, percentage: z.number().min(0).max(100) }),
  z.object({ type: z.literal('interrupt'), sessionId: uuidSchema }),
  z.object({ type: z.literal('shell'), sessionId: uuidSchema, command: z.string().trim().min(1).max(10_000) }),
  // id = existing /mcp card to refresh in place; absent = new card
  z.object({ type: z.literal('mcp'), sessionId: uuidSchema, id: z.string().uuid().optional(), action: mcpActionSchema.optional() }),
  z.object({ type: z.literal('permission'), sessionId: uuidSchema, reqId: z.string().min(1), allow: z.boolean(), updatedInput: z.record(z.string(), z.unknown()).optional(), always: z.boolean().optional() }),
]);
export type ClientMsgT = z.infer<typeof ClientMsg>;

export type ServerMsg =
  | { type: 'ready' }
  | { type: 'snapshot'; sessionId: string; history: HistoryItem[]; state: SessionState; lastSeq: number; totals: UsageTotals; pending: PendingPermission[]; bgTasks: BgTask[]; plan: boolean }
  | { type: 'event'; event: ClaudeEvent }
  | { type: 'error'; code: string; message: string; errorId?: string }
  | { type: 'log'; entry: LogEntry }
  | { type: 'connection.status'; id: string; status: ConnStatus; message?: string };

// text search: one hit per line of `text` containing `term` (case-insensitive); lines longer than `maxLine` are cropped around the match
export interface LineHit { nth: number; line: string; pre: string; match: string; post: string }
export function findLines(text: string, term: string, maxLine = 160): LineHit[] {
  const needle = term.toLowerCase();
  const lower = text.toLowerCase();
  const hits: LineHit[] = [];
  if (!needle) return hits;
  let pos = 0; // offset of the current line in the text
  for (const line of text.split('\n')) {
    const lineStart = pos;
    pos += line.length + 1;
    const at = lower.indexOf(needle, lineStart);
    if (at < 0 || at + needle.length > lineStart + line.length) continue;
    let nth = 0; // which occurrence of the term in the text this is
    for (let k = lower.indexOf(needle); k >= 0 && k < at; k = lower.indexOf(needle, k + 1)) nth++;
    const col = at - lineStart;
    let start = 0;
    let end = line.length;
    if (line.length > maxLine) {
      start = Math.max(0, col - Math.floor((maxLine - term.length) / 3));
      end = Math.min(line.length, start + maxLine);
    }
    hits.push({
      nth, line: line.slice(0, 1000),
      pre: (start > 0 ? '…' : '') + line.slice(start, col),
      match: line.slice(col, col + term.length),
      post: line.slice(col + term.length, end) + (end < line.length ? '…' : ''),
    });
  }
  return hits;
}
export interface ProjectHit extends LineHit { sessionId: string; name: string; role: 'user' | 'assistant' }

// Price table for counterfactuals (token audit, server/src/audit.ts) and the auto-compact estimate (web). USD per million tokens.
// Fitted to this machine's logged `costUsd` (not copied from a price list): cache writes land at ~2x input (the 1h cache tier)
// and the Sonnet 5 family is cheaper than earlier Sonnets. `npm run audit` prints the remaining drift; re-fit if it grows.
export interface Rates { input: number; output: number; cacheWrite: number; cacheRead: number }
export const RATES: Record<'haiku' | 'sonnet', Rates> = {
  haiku: { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 },
  sonnet: { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 },
};

/** estimated cost of one API message's usage; anything that is not Haiku is priced as Sonnet (the only other session model, Opus is subagent-only) */
export function usageCostUsd(model: string, u: { input: number; output: number; cacheCreation: number; cacheRead: number }): number {
  const r = model.includes('haiku') ? RATES.haiku : RATES.sonnet;
  return (u.input * r.input + u.output * r.output + u.cacheCreation * r.cacheWrite + u.cacheRead * r.cacheRead) / 1e6;
}

/** typical size of a context right after /compact (audit: 10k-29k tokens, median ~21k) */
export const POST_COMPACT_TOKENS = 22_000;
/**
 * What `/compact` costs at `preTokens` of context and how many later messages it takes to pay off (Sonnet rates).
 * Cost = re-reading the context + writing the summary (it becomes the new context) + one cache rebuild; saving = the cache reads
 * not paid on every later turn. `turns` is Infinity when the summary is not smaller than the context.
 */
export function compactBreakEven(preTokens: number): { costUsd: number; turns: number } {
  const r = RATES.sonnet; const post = POST_COMPACT_TOKENS;
  const costUsd = (preTokens * r.cacheRead + post * r.output + post * (r.cacheWrite - r.cacheRead)) / 1e6;
  const perTurn = (Math.max(0, preTokens - post) * r.cacheRead) / 1e6;
  return { costUsd, turns: perTurn > 0 ? Math.ceil(costUsd / perTurn) : Infinity };
}


/** Fixed context load of a session, from the SDK's `getContextUsage({ detail: 'full' })` minus the message history. */
export interface ContextBaseline {
  tokens: number; // everything except the conversation itself
  categories: Array<{ name: string; tokens: number }>; // 'used' categories only, largest first
  memoryFiles: Array<{ path: string; tokens: number }>; // CLAUDE.md-style files
  mcpServers: Array<{ name: string; tokens: number; tools: number }>; // loaded MCP tool schemas, summed per server
  skillsTokens: number;
}

export type BaselineTip = { id: string; text: string };

// Thresholds for baselineAdvice (tokens). A bare Claude Code session is ~15-20k; these flag what the user controls.
export const BASELINE_HEAVY_TOKENS = 35_000;
export const MEMORY_FILE_TOKENS = 3_000;
export const MEMORY_TOTAL_TOKENS = 5_000;
export const MCP_SERVER_TOKENS = 3_000;
export const SKILLS_TOKENS = 3_000;

/**
 * Actionable tips about the fixed load, which is paid again on every message (cheap as cache read, but it also eats the
 * smart zone). `usedMcp` = MCP server names already called in this session; an unused heavy server is the best candidate to drop.
 */
export function baselineAdvice(b: ContextBaseline, usedMcp: ReadonlySet<string> = new Set(), lean = false): BaselineTip[] {
  const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
  const tips: BaselineTip[] = [];
  for (const m of b.memoryFiles) if (m.tokens >= MEMORY_FILE_TOKENS) tips.push({ id: `memory:${m.path}`, text: `${m.path} ocupa ${k(m.tokens)} tokens em toda mensagem. Deixe só regras universais nele e mova procedimentos para docs/ lidos sob demanda.` });
  const memTotal = b.memoryFiles.reduce((a, m) => a + m.tokens, 0);
  if (memTotal >= MEMORY_TOTAL_TOKENS && !tips.some((t) => t.id.startsWith('memory:'))) tips.push({ id: 'memory:total', text: `Os arquivos de instruções somam ${k(memTotal)} tokens fixos. Considere enxugar ou mover detalhes para docs/ sob demanda.` });
  for (const s of b.mcpServers) if (s.tokens >= MCP_SERVER_TOKENS) {
    tips.push({ id: `mcp:${s.name}`, text: usedMcp.has(s.name) ? `O MCP "${s.name}" custa ${k(s.tokens)} tokens fixos (${s.tools} tools).` : `O MCP "${s.name}" custa ${k(s.tokens)} tokens fixos (${s.tools} tools) e ainda não foi usado nesta sessão. Desative-o se não for necessário.` });
  }
  if (b.skillsTokens >= SKILLS_TOKENS) tips.push({ id: 'skills', text: `As descrições de skills somam ${k(b.skillsTokens)} tokens fixos. Desative as que este projeto não usa.` });
  if (!lean && b.tokens >= BASELINE_HEAVY_TOKENS) tips.push({ id: 'lean', text: `A carga inicial é ${k(b.tokens)} tokens antes da primeira mensagem. Se a tarefa for simples, o modo Lean evita carregar instruções, skills e plugins.` });
  return tips;
}


// Planning first pays off on big, vague or multi-file work (the Explore -> Plan -> Execute cycle) and is wasted on a one-liner.
// Deliberately conservative: a false hit is only a dismissible hint. Client-side, before the message is sent.
const PLAN_VERBS = /\b(implementa|implement|refator|refactor|migra|migrat|integra|integrat|arquitet|architect|redesenh|redesign|reescrev|rewrit|construa|build|cri[ae]\s+(?:um|uma|o|a)\s+(?:novo|nova|sistema|m[oó]dulo|feature|funcionalidade|endpoint|tela|fluxo))/i;
const PLAN_SCOPE = /\b(todos?|todas?|toda|all|every|v[aá]rios|v[aá]rias|multiple|m[oó]dulos?|modules?|arquivos|files|backend e (?:o )?front|front ?end e (?:o )?back)\b/i;
export const PLAN_MIN_CHARS = 200;
export const PLAN_LONG_CHARS = 600;
export function suggestPlanMode(text: string): boolean {
  const t = text.trim();
  if (t.startsWith('/') || t.startsWith('!')) return false;
  if (t.length >= PLAN_LONG_CHARS) return true;
  return t.length >= PLAN_MIN_CHARS && PLAN_VERBS.test(t) && PLAN_SCOPE.test(t);
}


/**
 * Prompt for the "Analisar contexto" session: a read-only (plan mode) review of what can be trimmed from the fixed context.
 * The measured numbers come from the source session's `context.baseline`, so Claude does not have to guess or run /context.
 * `usedMcp` = MCP servers the source session already called; `extra` = the user's own instructions, appended last.
 */
export function buildContextAuditPrompt(baseline: ContextBaseline | undefined, usedMcp: ReadonlySet<string> = new Set(), extra = ''): string {
  const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
  const measured = baseline
    ? [
        `Fixed load measured in the source session: ${k(baseline.tokens)} tokens before the conversation.`,
        ...baseline.categories.slice(0, 8).map((c) => `- ${c.name}: ${k(c.tokens)}`),
        baseline.memoryFiles.length ? `Instruction files (CLAUDE.md):\n${baseline.memoryFiles.map((m) => `- ${m.path}: ${k(m.tokens)}`).join('\n')}` : '',
        baseline.mcpServers.length ? `MCP servers (fixed tokens; "used" = already called in the source session):\n${baseline.mcpServers.map((m) => `- ${m.name}: ${k(m.tokens)}, ${m.tools} tools, ${usedMcp.has(m.name) ? 'used' : 'not used there'}`).join('\n')}` : '',
        baseline.skillsTokens ? `Skill descriptions: ${k(baseline.skillsTokens)}` : '',
      ].filter(Boolean).join('\n')
    : 'No measurement available (the source session has not had a turn yet). Estimate by reading the files.';
  return [
    'Analyze what I can cut from the fixed context load of my sessions. Do NOT edit, delete or disable anything: only read and propose.',
    '',
    measured,
    '',
    '1. CLAUDE.md (global at ~/.claude/CLAUDE.md and the project one): list each section with its approximate size in tokens. Mark what does not need to apply in every session (long procedures, history, examples, details of a single area) and propose moving it to docs/ with a one-line pointer left behind. Point out duplicated or contradictory rules and anything derivable from the code or git. Keep the hard, verifiable rules (security, language, test commands, prohibitions). Show the proposed diff and the estimated savings.',
    '2. MCPs: for each server, confirm whether it was actually used by searching for "mcp__<server>__" calls in the .jsonl transcripts under ~/.claude/projects/ (last 30 days, counted per server and project). Classify as keep, rarely used (enable only when needed) or never used (disable), and say how to disable each one (exact command or file) and in which scope (user, project, local or plugin).',
    '3. Skills and plugins: point out the ones never invoked that have a large description.',
    '',
    'Deliver a table sorted by token savings and the change plan for me to approve item by item.',
    extra.trim() ? `\nExtra instructions from the user:\n${extra.trim()}` : '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}
