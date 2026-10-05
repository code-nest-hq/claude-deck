import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import type { DirEntry, Effort, EventBody, HistoryItem, McpAction, McpServerView, Model, ModelUsage, ShellResult, SlashCommandInfo, UsageTotals } from '@ccui/shared';

export interface SessionInfo { sessionId: string; summary: string; customTitle?: string; firstPrompt?: string; lastModified: number }

// Tudo o que difere entre rodar o Claude local ou remoto.
export interface Transport {
  spawn(o: SpawnOptions, onStderr: (chunk: string) => void): SpawnedProcess;
  isDirectory(path: string): Promise<boolean>;
  /** lista o conteúdo de um diretório; path null = resolve e lista o $HOME da conexão. null de volta = não existe/sem permissão/falha */
  listDir(path: string | null): Promise<{ path: string; entries: DirEntry[] } | null>;
  /** lê um arquivo inteiro em base64; null se não existe/não é arquivo/sem permissão/maior que maxBytes */
  readFile(path: string, maxBytes: number): Promise<string | null>;
  /** last `bytes` of a text file (background task output); null if missing/unreadable */
  tailFile(path: string, bytes: number): Promise<string | null>;
  listSessions(cwd: string): Promise<SessionInfo[]>;
  history(sessionId: string, cwd: string): Promise<HistoryItem[]>;
  sessionExists(sessionId: string, cwd: string): Promise<boolean>;
  /** custo/tokens acumulados da sessão (último `cost-state` do jsonl), ou null se ainda não há */
  usage(sessionId: string, cwd: string): Promise<{ totals: UsageTotals; modelUsage: Record<string, ModelUsage> } | null>;
  /** the session's whole jsonl transcript plus its subagent transcripts; null when the session has none on disk */
  readTranscript(sessionId: string, cwd: string): Promise<Transcript | null>;
  /** modo shell (`!cmd`): executa o comando DIGITADO PELO USUÁRIO no diretório do projeto (local ou remoto), com timeout e limite de saída */
  shell(cwd: string, command: string): Promise<ShellResult>;
  /** saída de `git status --porcelain=v2 --branch` do diretório, ou null (não é repositório / sem resposta) */
  git(cwd: string): Promise<string | null>;
  /** espera não haver `claude` ativo para a sessão (remoto: turno terminando após queda de SSH). Lança no timeout. */
  waitSessionIdle(sessionId: string, timeoutMs: number): Promise<void>;
}
/** routing verdict: where it came from, and what the throwaway Haiku call cost (only when `source` is 'haiku') */
export interface Classification { model: Model; source: 'heuristic' | 'learned' | 'haiku' | 'fallback'; costUsd?: number; durationMs: number }
/** a session's raw Claude Code transcript (jsonl text) and its subagents' transcripts, for the export */
export interface Transcript { main: string; subagents: Array<{ id: string; meta: string | null; jsonl: string }> }
export interface OpenOptions {
  cwd: string; sessionId: string; model: Model; effort: Effort; lean: boolean; routing: boolean; permissionMode: 'default' | 'plan' | 'bypassPermissions';
}
export interface LiveSession {
  /** true when the process resumed an existing session, false when it started a fresh one */
  readonly resumed?: boolean;
  send(text: string, attachments?: string[]): void;
  interrupt(): Promise<void>;
  answerPermission(reqId: string, allow: boolean, updatedInput?: Record<string, unknown>): void;
  setModel(model: Model): Promise<void>;
  /** `/mcp`: applies the action (if any) and returns the servers' status */
  mcp(action?: McpAction): Promise<{ servers: McpServerView[]; error?: string }>;
  /** re-reads skills and plugins from disk into the running process (new skills, installed plugins, their MCP servers) */
  reload(): Promise<{ plugins: number; errors: number }>;
  /** tail of a background task's output file; null when unknown (no output file yet) or unreadable */
  bgOutput(taskId: string): Promise<string | null>;
  stopTask(taskId: string): Promise<void>;
  close(): Promise<void>;
  events: AsyncIterable<EventBody>;
}
export interface ClaudeRuntime {
  listSessions(cwd: string): Promise<SessionInfo[]>;
  history(sessionId: string, cwd: string): Promise<HistoryItem[]>;
  open(o: OpenOptions): Promise<LiveSession>;
  usage(sessionId: string, cwd: string): Promise<{ totals: UsageTotals; modelUsage: Record<string, ModelUsage> } | null>;
  shell(cwd: string, command: string): Promise<ShellResult>;
  /** comandos `/` disponíveis para o projeto (skills, plugins e nativos permitidos); não envia nada ao modelo */
  commands(cwd: string, lean: boolean): Promise<SlashCommandInfo[]>;
  /** `/mcp` without a live session: short-lived process, no message sent (no token cost) */
  mcp(cwd: string, lean: boolean, action?: McpAction): Promise<{ servers: McpServerView[]; error?: string }>;
  /** decide Haiku ou Sonnet pra uma mensagem (heurística + fallback Haiku descartável) */
  classify(cwd: string, text: string): Promise<Classification>;
  /** após uma queda: espera o claude da sessão terminar (não lança) */
  settle(sessionId: string, cwd: string): Promise<void>;
}
