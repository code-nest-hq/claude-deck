import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BgTask } from '@ccui/shared';

const KEEP = 20; // finished tasks kept in the list so the user can still check how they ended
// a backgrounded Bash's tool_result placeholder: "Command running in background with ID: x. Output is being written to: <path>"
const OUTPUT_RE = /Output is being written to: (\S+?\.output)\b/;

type Track = BgTask & { bg: boolean; outputFile?: string };

// background tasks of one process, fed from the SDK stream: task_started / task_updated / task_notification (edges)
// plus background_tasks_changed (the live set). Ambient/housekeeping tasks are never listed.
export class BgTasks {
  private tasks = new Map<string, Track>();

  /** true when the visible list changed */
  apply(m: SDKMessage): boolean {
    if (m.type !== 'system') return false;
    switch (m.subtype) {
      case 'task_started': {
        if (m.ambient || m.skip_transcript) return false;
        const prev = this.tasks.get(m.task_id); // background_tasks_changed may arrive first
        const bg = !!m.is_backgrounded || !!prev?.bg;
        this.tasks.set(m.task_id, { ...prev, taskId: m.task_id, toolUseId: m.tool_use_id, kind: m.task_type ?? prev?.kind ?? 'task', description: m.description, status: 'running', startedAt: prev?.startedAt ?? Date.now(), bg });
        return bg;
      }
      case 'task_updated': {
        const t = this.tasks.get(m.task_id);
        if (!t) return false;
        if (m.patch.is_backgrounded) t.bg = true;
        if (m.patch.description) t.description = m.patch.description;
        const s = m.patch.status;
        if (s === 'completed' || s === 'failed' || s === 'killed') this.end(t, s === 'killed' ? 'stopped' : s, m.patch.end_time);
        return t.bg;
      }
      case 'task_notification': {
        const t = this.tasks.get(m.task_id);
        if (!t) return false;
        t.outputFile = m.output_file || t.outputFile;
        if (m.summary) t.summary = m.summary;
        this.end(t, m.status);
        return t.bg;
      }
      case 'background_tasks_changed': {
        let changed = false;
        for (const x of m.tasks) {
          if (x.ambient) continue;
          const t = this.tasks.get(x.task_id);
          if (!t) this.tasks.set(x.task_id, { taskId: x.task_id, kind: x.task_type, description: x.description, status: 'running', startedAt: Date.now(), bg: true });
          else if (!t.bg) t.bg = true;
          else continue;
          changed = true;
        }
        return changed;
      }
      default:
        return false;
    }
  }

  /** the Bash placeholder result tells where the output goes while the task still runs (task_notification only says it at the end) */
  toolResult(toolUseId: string, output: string) {
    const t = [...this.tasks.values()].find((x) => x.toolUseId === toolUseId);
    const f = t && OUTPUT_RE.exec(output)?.[1];
    if (t && f) t.outputFile = f;
  }

  outputFile(taskId: string) { return this.tasks.get(taskId)?.outputFile; }

  /** process gone: whatever was still running died with it */
  stopAll(): boolean {
    let changed = false;
    for (const t of this.tasks.values()) if (t.status === 'running') { this.end(t, 'stopped'); changed ||= t.bg; }
    return changed;
  }

  list(): BgTask[] {
    return [...this.tasks.values()].filter((t) => t.bg).sort((a, b) => b.startedAt - a.startedAt).slice(0, KEEP)
      .map(({ bg: _bg, outputFile: _f, ...t }) => t);
  }

  private end(t: Track, status: BgTask['status'], at = Date.now()) {
    if (t.status !== 'running') return;
    t.status = status;
    t.endedAt = at;
  }
}
