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
export interface Project { id: string; name: string; connectionId: string; path: string; lean: boolean; routing?: boolean; bypass?: boolean; autoCompact?: boolean; model?: Model; effort?: Effort }
export interface SessionMeta {
  sessionId: string; projectId: string; name?: string; model?: Model; effort?: Effort; routing?: boolean;
  tags?: string[]; favorite?: boolean; archived?: boolean; createdAt: number; lastUsedAt: number;
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
export interface SessionRow { sessionId: string; name: string; lastModified: number; live: boolean; tags: string[]; favorite: boolean; archived: boolean }
export interface SlashCommandInfo { name: string; description: string; argumentHint: string; aliases?: string[]; builtin: boolean }
export interface GitInfo { branch: string | null; ahead: number; behind: number; changed: number; untracked: number }
export interface DirEntry { name: string; isDir: boolean }
export const LOCAL: Connection = { id: 'local', kind: 'local', label: 'Local' };
export interface TodayUsage { totalCostUsd: number; byModel: Record<string, number>; byProject: Record<string, number> }
export interface ProjectUsageView { totalCostUsd: number; sessions: Array<{ sessionId: string; name: string; lastModified: number; costUsd: number }> }

const name = (max: number) => z.string().trim().min(1).max(max);
export const createProjectBody = z.object({ name: name(80), path: z.string().min(1).max(1024), lean: z.boolean().default(false), connectionId: z.string().min(1).default('local') });
export const createConnectionBody = z.object({ target: z.string().min(1).max(255), label: name(80).optional(), claudePath: z.string().max(255).optional() });
export const patchProjectBody = z.object({ name: name(80).optional(), lean: z.boolean().optional(), routing: z.boolean().optional(), bypass: z.boolean().optional(), autoCompact: z.boolean().optional(), model: modelSchema.optional(), effort: effortSchema.optional() });
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
export const createSessionBody =z.object({ name: name(120), model: modelSchema.optional(), effort: effortSchema.optional(), routing: z.boolean().optional() });
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
export interface PendingPermission { reqId: string; toolName: string; input: unknown }
export type EventBody =
  | { type: 'session.state'; state: SessionState }
  | { type: 'user.message'; text: string }
  | { type: 'message.delta'; text: string }
  | { type: 'message.completed'; text: string }
  | { type: 'tool.started'; toolUseId: string; name: string; input: unknown; taskId?: string }
  | { type: 'tool.result'; toolUseId: string; output: string; isError: boolean; taskId?: string }
  // subagente (Task tool): taskId = tool_use_id do Task tool. Só 1º nível vira aba no cliente.
  | { type: 'task.started'; taskId: string; subagentType?: string; description: string }
  | { type: 'task.updated'; taskId: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused' }
  | { type: 'routing.started' }
  | { type: 'model.routed'; model: Model }
  | ({ type: 'permission.requested' } & PendingPermission)
  | { type: 'permission.resolved'; reqId: string; allow: boolean }
  // modelUsage: no evento entregue ao cliente é o gasto SÓ deste turno, por modelo (delta calculado em hub.ts)
  | { type: 'turn.completed'; totals: UsageTotals; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; modelUsage: Record<string, ModelUsage> }
  // context window occupancy after a turn (SDK getContextUsage 'summary', no token cost); percentage is of the autocompact window
  | { type: 'context.usage'; percentage: number; totalTokens: number; maxTokens: number }
  // `/compact` (manual or the CLI's own auto-compact): no real progress is reported, only start and end
  | { type: 'compact'; phase: 'started' | 'done' | 'failed'; preTokens?: number; postTokens?: number; message?: string }
  | { type: 'shell.started'; id: string; command: string }
  | ({ type: 'shell.result'; id: string } & ShellResult)
  // `/mcp` panel: servers absent = still loading (the client keeps the previous list while it refreshes)
  | { type: 'mcp.status'; id: string; servers?: McpServerView[]; error?: string }
  | { type: 'error'; code: 'runtime' | 'exit'; message: string };
export type ClaudeEvent = EventBody & { sessionId: string; seq: number; ts: number };
export interface HistoryItem { role: 'user' | 'assistant'; text: string }
// acumulado da sessão (todas as execuções, inclusive antes de um resume); custo é ESTIMATIVA a preço de API (não é cobrança em plano de assinatura)
export interface UsageTotals { costUsd: number; input: number; output: number; cacheCreation: number; cacheRead: number }
export interface ModelUsage { input: number; output: number; cacheCreation: number; cacheRead: number; costUsd: number }
export interface ShellResult { output: string; exitCode: number | null; truncated: boolean }
export type McpStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
// what the terminal's /mcp shows; never env/headers (may carry secrets)
export interface McpServerView {
  name: string; status: McpStatus; scope?: string; transport?: string; target?: string; error?: string;
  serverInfo?: { name: string; version: string }; tools: Array<{ name: string; description?: string }>;
}
export const mcpActionSchema = z.object({ kind: z.enum(['reconnect', 'enable', 'disable']), server: z.string().min(1).max(200) });
export type McpAction = z.infer<typeof mcpActionSchema>;
export const ZERO_TOTALS: UsageTotals = { costUsd: 0, input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

// ---- protocolo WebSocket ----
export const ClientMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('attach'), sessionId: uuidSchema, projectId: z.string().min(1), afterSeq: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('detach'), sessionId: uuidSchema }),
  z.object({ type: z.literal('send'), sessionId: uuidSchema, text: z.string().min(1).max(200_000), attachments: z.array(z.string()).max(10).optional() }),
  z.object({ type: z.literal('interrupt'), sessionId: uuidSchema }),
  z.object({ type: z.literal('shell'), sessionId: uuidSchema, command: z.string().trim().min(1).max(10_000) }),
  // id = existing /mcp card to refresh in place; absent = new card
  z.object({ type: z.literal('mcp'), sessionId: uuidSchema, id: z.string().uuid().optional(), action: mcpActionSchema.optional() }),
  z.object({ type: z.literal('permission'), sessionId: uuidSchema, reqId: z.string().min(1), allow: z.boolean(), updatedInput: z.record(z.string(), z.unknown()).optional() }),
]);
export type ClientMsgT = z.infer<typeof ClientMsg>;

export type ServerMsg =
  | { type: 'ready' }
  | { type: 'snapshot'; sessionId: string; history: HistoryItem[]; state: SessionState; lastSeq: number; totals: UsageTotals; pending: PendingPermission[] }
  | { type: 'event'; event: ClaudeEvent }
  | { type: 'error'; code: string; message: string }
  | { type: 'connection.status'; id: string; status: ConnStatus; message?: string };
