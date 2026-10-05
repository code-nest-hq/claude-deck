import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { EventBody, ModelUsage, UsageTotals } from '@ccui/shared';

export const blockText = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text : '')).join('') : '';

// modelUsage (por modelo) -> totais; thinking já está contado em output
export function sumUsage(mu: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number }> | undefined, costFallback = 0): UsageTotals {
  const t: UsageTotals = { costUsd: 0, input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  for (const u of Object.values(mu ?? {})) {
    t.costUsd += u.costUSD ?? 0; t.input += u.inputTokens ?? 0; t.output += u.outputTokens ?? 0;
    t.cacheCreation += u.cacheCreationInputTokens ?? 0; t.cacheRead += u.cacheReadInputTokens ?? 0;
  }
  if (!t.costUsd) t.costUsd = costFallback;
  return t;
}

// mesmo dado do modelUsage do SDK, por modelo, sem somar: hub.ts usa isto pra calcular o delta do turno
// (também usado por jsonl.ts pra semear o mesmo snapshot ao ler o cost-state gravado)
export function rawModelUsage(mu: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number }> | undefined): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = {};
  for (const [model, u] of Object.entries(mu ?? {})) {
    out[model] = { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, cacheCreation: u.cacheCreationInputTokens ?? 0, cacheRead: u.cacheReadInputTokens ?? 0, costUsd: u.costUSD ?? 0 };
  }
  return out;
}

// Transcripts criados no terminal guardam o modo shell (`!cmd`) e comandos `/` como texto com tags; mostra de forma legível.
export function cleanTags(text: string): string {
  const fence = (body: string) => (body.trim() ? `\`\`\`
${body.trim()}
\`\`\`` : '');
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<bash-input>([\s\S]*?)<\/bash-input>/g, (_, c: string) => `\`\`\`bash\n$ ${c.trim()}\n\`\`\``)
    .replace(/<(bash-stdout|bash-stderr|local-command-stdout)>([\s\S]*?)<\/\1>/g, (_, __, o: string) => fence(o))
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, (_, n: string) => n.trim())
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, (_, a: string) => (a.trim() ? ` ${a.trim()}` : ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function mapMessage(m: SDKMessage): EventBody[] {
  // parent_tool_use_id = tool_use_id do Task tool que chamou este subagente; undefined fora de um subagente
  const taskId = 'parent_tool_use_id' in m ? (m.parent_tool_use_id ?? undefined) : undefined;
  switch (m.type) {
    case 'stream_event': {
      if (taskId) return []; // sem streaming de texto de subagente (só as ferramentas que ele chama)
      const e = m.event;
      return e.type === 'content_block_delta' && e.delta.type === 'text_delta' ? [{ type: 'message.delta', text: e.delta.text }] : [];
    }
    case 'assistant': {
      const out: EventBody[] = [];
      for (const b of m.message.content) {
        if (taskId) {
          // dentro de um subagente: só repassa a ferramenta chamada (log de comandos daquela aba)
          if (b.type === 'tool_use') out.push({ type: 'tool.started', toolUseId: b.id, name: b.name, input: b.input, taskId });
        } else {
          if (b.type === 'text' && b.text) out.push({ type: 'message.completed', text: b.text });
          else if (b.type === 'tool_use') out.push({ type: 'tool.started', toolUseId: b.id, name: b.name, input: b.input });
        }
      }
      return out;
    }
    case 'user': {
      const c = m.message.content;
      if (!Array.isArray(c)) return [];
      return c.flatMap((b) =>
        b.type === 'tool_result'
          ? [{ type: 'tool.result' as const, toolUseId: b.tool_use_id, output: blockText(b.content), isError: !!b.is_error, ...(taskId ? { taskId } : {}) }]
          : [],
      );
    }
    case 'result': {
      const u = m.usage;
      const out: EventBody[] = [{
        type: 'turn.completed', totals: sumUsage(m.modelUsage, m.total_cost_usd),
        inputTokens: u.input_tokens, outputTokens: u.output_tokens,
        cacheCreationTokens: u.cache_creation_input_tokens, cacheReadTokens: u.cache_read_input_tokens,
        modelUsage: rawModelUsage(m.modelUsage), // cumulativo aqui; hub.ts converte pra delta do turno antes de enviar ao cliente
      }];
      if (m.subtype !== 'success' || m.is_error) {
        out.push({
          type: 'error',
          code: 'runtime',
          message: m.subtype === 'success' ? m.result : m.errors.join('; '),
        });
      }
      return out;
    }
    case 'system':
      // task_updated não entra aqui: não traz tool_use_id, só task_id — sdk-runtime.ts resolve com o Map dele e emite direto
      if (m.subtype === 'task_started' && !m.skip_transcript && !m.ambient && m.tool_use_id) {
        return [{ type: 'task.started', taskId: m.tool_use_id, subagentType: m.subagent_type, description: m.description }];
      }
      if (m.subtype === 'status') {
        if (m.status === 'compacting') return [{ type: 'compact', phase: 'started' }];
        if (m.compact_result === 'failed') return [{ type: 'compact', phase: 'failed', message: m.compact_error }];
      }
      if (m.subtype === 'compact_boundary') {
        return [{ type: 'compact', phase: 'done', preTokens: m.compact_metadata.pre_tokens, postTokens: m.compact_metadata.post_tokens }];
      }
      return [];
    default:
      return []; // hooks, status, rate_limit, etc.
  }
}
