import { parse } from './export';

// "New session with handoff": a compact prompt that lets a fresh session continue the work of a long one, built from
// the Claude Code transcript with no model call (the Haiku distillation is opt-in, see HANDOFF_SYSTEM_PROMPT).
// Pure function: the route does the IO.

const MAX_REQUESTS = 40;
const MAX_FILES = 60;
const RECENT_ASSISTANT = 6;

export const HANDOFF_SYSTEM_PROMPT = `You distill a handoff for a coding session that is being continued in a fresh session.
You receive an extracted summary of the previous session plus its most recent assistant messages.
Answer with at most 12 short bullets under two headings: "Decisions" (what was decided and why) and "Pending" (what is left, known problems, pitfalls).
Use only what the text states. Do not invent files, commands or results. No preamble.`;

interface Todo { status?: string; content?: string }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function textOf(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return (c as Array<{ type?: string; text?: string }>).map((b) => (b?.type === 'text' ? b.text ?? '' : '')).join('\n');
}

export interface Handoff {
  /** the prompt for the new session */
  text: string;
  /** the last assistant messages, extra material for the optional Haiku distillation (not part of `text`) */
  recent: string;
}

export function buildHandoff(mainJsonl: string): Handoff {
  const requests: string[] = [];
  const assistant: string[] = [];
  const edited: string[] = [];
  const commits: string[] = [];
  let todos: Todo[] = [];

  for (const e of parse(mainJsonl)) {
    const c = e.message?.content;
    if (e.type === 'user' && !e.isMeta && !e.sourceToolUseID && !e.isCompactSummary) {
      const s = textOf(c).trim();
      if (s && !s.startsWith('<') && !s.startsWith('[Request interrupted')) requests.push(s);
    } else if (e.type === 'assistant' && Array.isArray(c)) {
      for (const b of c as Array<Record<string, unknown>>) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) assistant.push(b.text.trim());
        if (b.type !== 'tool_use') continue;
        const i = (b.input ?? {}) as Record<string, unknown>;
        const file = i.file_path ?? i.notebook_path;
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(String(b.name)) && typeof file === 'string' && !edited.includes(file)) edited.push(file);
        else if (b.name === 'Bash' && typeof i.command === 'string' && i.command.includes('git commit')) commits.push(oneLine(i.command));
        else if (b.name === 'TodoWrite' && Array.isArray(i.todos)) todos = i.todos as Todo[];
      }
    }
  }

  const lines = [
    'This session continues work from a previous Claude Code session that was reset because its context grew too large. What follows was extracted from that session, not remembered by you: re-read any file before relying on or editing it.',
    '',
    '## Original goal',
    clip(requests[0] ?? '(none)', 1500),
  ];
  const rest = requests.slice(1);
  if (rest.length) {
    lines.push('', `## Follow-up requests (chronological${rest.length > MAX_REQUESTS ? `, last ${MAX_REQUESTS} of ${rest.length}` : ''})`);
    for (const r of rest.slice(-MAX_REQUESTS)) lines.push(`- ${clip(oneLine(r), 300)}`);
  }
  if (edited.length) {
    lines.push('', `## Files modified${edited.length > MAX_FILES ? ` (last ${MAX_FILES} of ${edited.length})` : ''}`);
    for (const f of edited.slice(-MAX_FILES)) lines.push(`- ${f}`);
  }
  if (commits.length) lines.push('', '## Commits made', ...commits.slice(-10).map((c) => `- ${clip(c, 200)}`));
  const open = todos.filter((t) => t.status !== 'completed');
  if (open.length) lines.push('', '## Open todos', ...open.map((t) => `- [${t.status}] ${t.content}`));
  lines.push('', '## Last assistant message (state and next steps)', clip(assistant.at(-1) ?? '(none)', 2000));

  const recent = assistant.slice(-RECENT_ASSISTANT).map((a) => clip(a, 1500)).join('\n---\n');
  return { text: lines.join('\n'), recent };
}
