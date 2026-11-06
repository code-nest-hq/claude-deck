import type { Item } from './reduce';

// Compact or start fresh? Per Anthropic's guidance the choice depends on whether the history is still relevant, not
// only on its size: a finished unit of work (commit) or a turn that moved to different files means the old context is
// mostly dead weight, so a handoff beats a compaction. Derived client-side from the chat items, no model call.
export type ContextAdvice = { action: 'compact' | 'fresh'; reason?: 'commit' | 'drift' | 'size' };

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// edits before the last turn needed to call a disjoint last turn "drift" (with fewer, the history says too little)
const MIN_EARLIER_FILES = 3;
// From here a compaction rarely pays off: the token audit measured a median of 2 messages left after crossing 100k,
// while compacting needs ~10 to break even (compactBreakEven). Keep in sync with COMPACT_TOKENS.
export const HANDOFF_DEFAULT_TOKENS = 100_000;

const editedFile = (it: Item): string | undefined => {
  if (it.kind !== 'tool' || !EDIT_TOOLS.has(it.name)) return undefined;
  const i = (it.input ?? {}) as Record<string, unknown>;
  const f = i.file_path ?? i.notebook_path;
  return typeof f === 'string' ? f : undefined;
};

const isCommit = (it: Item): boolean =>
  (it.kind === 'tool' && it.name === 'Bash' && !it.isError && /\bgit commit\b/.test(String((it.input as { command?: unknown } | null)?.command ?? ''))) ||
  (it.kind === 'shell' && it.exitCode === 0 && /\bgit commit\b/.test(it.command));

export function contextAdvice(items: Item[], totalTokens = 0): ContextAdvice {
  const bySize: ContextAdvice = totalTokens >= HANDOFF_DEFAULT_TOKENS ? { action: 'fresh', reason: 'size' } : { action: 'compact' };
  const last = items.map((it) => it.kind).lastIndexOf('user');
  if (last < 0) return bySize;
  const turn = items.slice(last + 1);
  if (turn.some(isCommit)) return { action: 'fresh', reason: 'commit' };
  const before = new Set(items.slice(0, last).map(editedFile).filter((f): f is string => !!f));
  const now = new Set(turn.map(editedFile).filter((f): f is string => !!f));
  if (before.size >= MIN_EARLIER_FILES && now.size > 0 && ![...now].some((f) => before.has(f))) return { action: 'fresh', reason: 'drift' };
  return bySize;
}

export const adviceText = (a: ContextAdvice): string =>
  a.reason === 'commit' ? 'A última etapa terminou em um commit: o histórico antigo provavelmente não é mais necessário, uma sessão nova com handoff costuma ser melhor que compactar.'
    : a.reason === 'drift' ? 'O último turno mexeu em arquivos diferentes dos anteriores: a tarefa parece ter mudado, uma sessão nova com handoff costuma ser melhor que compactar.'
      : a.reason === 'size' ? 'Com este contexto, compactar raramente compensa: sessões costumam ter poucas mensagens restantes. Uma sessão nova com handoff costuma sair mais barata.'
        : '';

// MCP servers this session already called (tool names look like `mcp__<server>__<tool>`)
export function usedMcpServers(items: Item[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) if (it.kind === 'tool') { const m = /^mcp__(.+?)__/.exec(it.name); if (m) out.add(m[1]); }
  return out;
}
