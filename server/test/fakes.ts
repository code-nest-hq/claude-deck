import type { ClaudeEvent, EventBody, Model, ServerMsg } from '@ccui/shared';
import type { Client } from '../src/hub';
import type { ClaudeRuntime, LiveSession, OpenOptions } from '../src/runtime/types';

// push/end async queue (same shape as sdk-runtime's channel)
export function queue<T>() {
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

/** a Claude process: each send() answers with one assistant message and a completed turn, unless `onSend` says otherwise */
export class FakeLive implements LiveSession {
  sent: string[] = [];
  models: Model[] = [];
  closed = false;
  out = queue<EventBody>();
  events = this.out;
  constructor(private onSend?: (text: string, live: FakeLive) => void) {}
  reply(text: string) {
    this.out.push({ type: 'message.completed', text });
    this.out.push({ type: 'turn.completed', totals: { costUsd: 0.01, input: 1, output: 1, cacheCreation: 0, cacheRead: 0 }, inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, modelUsage: {} });
  }
  send(text: string) {
    this.sent.push(text);
    if (this.onSend) this.onSend(text, this);
    else this.reply(`echo: ${text}`);
  }
  async interrupt() {}
  answerPermission() {}
  async setModel(m: Model) {
    if (this.closed) throw new Error('process is gone');
    this.models.push(m);
  }
  async mcp() { return { servers: [] }; }
  async reload() { return { plugins: 0, errors: 0 }; }
  async bgOutput() { return null; }
  async stopTask() {}
  async close() { this.closed = true; this.out.end(); }
  /** the process exits on its own */
  exit() { this.closed = true; this.out.end(); }
}

export interface FakeRuntime extends ClaudeRuntime { lives: FakeLive[]; classified: string[]; opened: OpenOptions[] }

export function fakeRuntime(o: { classify?: (text: string) => Promise<Model>; onSend?: (text: string, live: FakeLive) => void } = {}): FakeRuntime {
  const rt: FakeRuntime = {
    lives: [], classified: [], opened: [],
    async listSessions() { return []; },
    async history() { return []; },
    async open(opts) { rt.opened.push(opts); const l = new FakeLive(o.onSend); rt.lives.push(l); return l; },
    async usage() { return null; },
    async shell() { return { output: '', exitCode: 0, truncated: false }; },
    async commands() { return []; },
    async mcp() { return { servers: [] }; },
    async classify(_cwd, text) { rt.classified.push(text); return { model: await (o.classify ? o.classify(text) : 'haiku'), source: 'heuristic', durationMs: 0 }; },
    async handoffNotes() { return { text: '- Decisions: none' }; },
    async settle() {},
  };
  return rt;
}

/** a WebSocket client stand-in that records what the hub sends it */
export function recorder() {
  const msgs: ServerMsg[] = [];
  const client: Client = { sessions: new Set(), send: (m) => { msgs.push(m); } };
  const events = () => msgs.flatMap((m) => (m.type === 'event' ? [m.event] : []));
  const waitFor = async (pred: (e: ClaudeEvent) => boolean, ms = 3000): Promise<ClaudeEvent> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = events().find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timed out waiting for an event; got: ${events().map((e) => e.type).join(', ')}`);
  };
  return { client, msgs, events, waitFor };
}
