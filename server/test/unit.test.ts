// Fast, free checks (no Claude process, no tokens): `npm test`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Model } from '@ccui/shared';
import { fakeRuntime, recorder, type FakeLive } from './fakes';

// isolated data dir BEFORE loading anything that reads it (store.ts / logs.ts)
process.env.CCUI_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ccui-test-data-'));
const { SessionHub } = await import('../src/hub');
const { logDay, logDays, readLogs, logError } = await import('../src/logs');
const { classifyHeuristic, learnedRoute, learnRoute } = await import('../src/runtime/routing');
const { mapMessage } = await import('../src/runtime/events');
const { BgTasks } = await import('../src/runtime/bg-tasks');
const { localTransport } = await import('../src/runtime/local-transport');
const { encodeCwd } = await import('../src/ssh-util');
const { parseHistory, jsonlTimestamps, parseRemoteTranscript, FILE_MARK } = await import('../src/runtime/jsonl');
const { recordSession, readSessionLog, flushSessionLog } = await import('../src/session-log');
const { redactString, redactDeep } = await import('../src/redact');
const { buildExport } = await import('../src/export');

const spec = { cwd: '/tmp/project', model: 'sonnet' as Model, effort: 'medium' as const, lean: true, routing: true, permissionMode: 'default' as const };
const label = () => ({ projectId: 'p1', projectName: 'Test project', sessionName: 'test session' });
function hubWith(rt: ReturnType<typeof fakeRuntime>, routing = true) {
  const hub = new SessionHub(() => rt, () => ({ ...spec, routing }), label);
  const id = randomUUID();
  const r = recorder();
  return { hub, id, ...r, attach: () => hub.attach(r.client, id) };
}

describe('Model Routing heuristic', () => {
  const cases: Array<[string, Model | null]> = [
    ['implementa o endpoint de login com validação', 'sonnet'],
    ['refactor the payment service into smaller modules', 'sonnet'],
    ['fix this bug in the checkout flow', 'sonnet'],
    ['migrate the users table to the new schema', 'sonnet'],
    // verb forms: the stems must match as prefixes, otherwise every coding request pays an extra classifier call
    ['refatorar o serviço de pagamento', 'sonnet'],
    ['implementing the login page', 'sonnet'],
    ['criar um endpoint novo', 'sonnet'],
    ['construir a tela de cadastro', 'sonnet'],
    ['integrar com o stripe', 'sonnet'],
    ['creating a settings page', 'sonnet'],
    ['o que faz a função parseGitStatus?', 'haiku'],
    ['explain what this regex matches', 'haiku'],
    ['lista os arquivos alterados', 'haiku'],
    ['qual branch estou?', 'haiku'],
    ['', 'haiku'],
    ['x'.repeat(401), 'sonnet'], // long prompt: likely a big task
    ['por que o céu é azul?', null], // gray zone: decided by the Haiku classifier
    // commit message over a diff already in context: text generation, not coding
    ['generate commit message', 'haiku'],
    ['cria a mensagem de commit', 'haiku'],
  ];
  for (const [text, want] of cases) {
    test(`${JSON.stringify(text.slice(0, 50))} -> ${want ?? 'classifier'}`, () => assert.equal(classifyHeuristic(text), want));
  }
  test('a question that asks to build something goes to Sonnet (cost only saved when it is safe)', () => {
    assert.equal(classifyHeuristic('explica e depois implementa o cache'), 'sonnet');
  });
  test('learned routes: normalized lookup, persisted to the data dir, long prompts not stored', async () => {
    assert.equal(learnedRoute('roda os testes'), null);
    learnRoute('Roda   os testes!', 'haiku');
    assert.equal(learnedRoute('roda os testes'), 'haiku');
    learnRoute('y'.repeat(201), 'sonnet');
    assert.equal(learnedRoute('y'.repeat(201)), null);
    await new Promise((r) => setTimeout(r, 50));
    const file = JSON.parse(readFileSync(path.join(process.env.CCUI_DATA_DIR!, 'routing-learned.json'), 'utf8'));
    assert.deepEqual(file, { 'roda os testes': 'haiku' });
  });
});

describe('SessionHub send (fake runtime)', () => {
  test('routing: classifies, switches the model, then delivers the message and the reply', async () => {
    const rt = fakeRuntime({ classify: async () => 'haiku' });
    const h = hubWith(rt);
    await h.attach();
    assert.equal(await h.hub.send(h.id, 'o que é isso?'), 'ok');
    await h.waitFor((e) => e.type === 'turn.completed');
    const types = h.events().map((e) => e.type).filter((t) => t !== 'session.state');
    assert.deepEqual(types, ['routing.started', 'model.routed', 'user.message', 'message.completed', 'turn.completed']);
    assert.deepEqual(rt.classified, ['o que é isso?']);
    assert.deepEqual(rt.lives[0].models, ['haiku']);
    assert.deepEqual(rt.lives[0].sent, ['o que é isso?']);
    const routed = h.events().find((e) => e.type === 'model.routed');
    assert.equal(routed?.type === 'model.routed' && routed.model, 'haiku');
  });

  test('without routing: no classifier call, no model switch', async () => {
    const rt = fakeRuntime();
    const h = hubWith(rt, false);
    await h.attach();
    await h.hub.send(h.id, 'hello');
    await h.waitFor((e) => e.type === 'turn.completed');
    assert.deepEqual(rt.classified, []);
    assert.deepEqual(rt.lives[0].models, []);
    assert.deepEqual(rt.lives[0].sent, ['hello']);
  });

  test('/compact skips routing and keeps the current model', async () => {
    const rt = fakeRuntime();
    const h = hubWith(rt);
    await h.attach();
    await h.hub.send(h.id, '/compact');
    await h.waitFor((e) => e.type === 'turn.completed');
    assert.deepEqual(rt.classified, []);
    assert.ok(!h.events().some((e) => e.type === 'routing.started'));
    assert.deepEqual(rt.lives[0].sent, ['/compact']);
  });

  test('a second message reuses the live process', async () => {
    const rt = fakeRuntime();
    const h = hubWith(rt);
    await h.attach();
    await h.hub.send(h.id, 'one');
    await h.waitFor((e) => e.type === 'turn.completed');
    await h.hub.send(h.id, 'two');
    await h.waitFor((e) => e.type === 'message.completed' && e.text === 'echo: two');
    assert.equal(rt.lives.length, 1);
    assert.deepEqual(rt.lives[0].sent, ['one', 'two']);
  });

  test('busy while a turn runs', async () => {
    const rt = fakeRuntime({ onSend: () => {} }); // never answers
    const h = hubWith(rt, false);
    await h.attach();
    await h.hub.send(h.id, 'one');
    assert.equal(await h.hub.send(h.id, 'two'), 'busy');
  });

  // a finished background task makes the CLI start a turn by itself (no send()): the session must show it as running
  test('a turn started by the CLI (task notification) goes running, then idle', async () => {
    const rt = fakeRuntime();
    const h = hubWith(rt, false);
    await h.attach();
    await h.hub.send(h.id, 'one');
    await h.waitFor((e) => e.type === 'turn.completed');
    const seq = h.events().length;
    rt.lives[0].reply('suite passed');
    await h.waitFor((e) => e.type === 'turn.completed' && e.seq > seq);
    const states = h.events().slice(seq).flatMap((e) => (e.type === 'session.state' ? [e.state] : []));
    assert.deepEqual(states, ['running', 'idle']);
  });

  test('bg.tasks list is kept for the snapshot', async () => {
    const rt = fakeRuntime();
    const h = hubWith(rt, false);
    await h.attach();
    await h.hub.send(h.id, 'one');
    const task = { taskId: 'b1', kind: 'local_bash', description: 'tests', status: 'running' as const, startedAt: 1 };
    rt.lives[0].out.push({ type: 'bg.tasks', tasks: [task] });
    await h.waitFor((e) => e.type === 'bg.tasks');
    const r = recorder();
    await h.hub.attach(r.client, h.id);
    const snap = r.msgs.find((m) => m.type === 'snapshot');
    assert.deepEqual(snap?.type === 'snapshot' && snap.bgTasks, [task]);
  });

  // regression: "Cannot read properties of null (reading 'setModel')"
  test('process exiting during the classifier call: a new one is opened and the message still goes out', async () => {
    let release!: (m: Model) => void;
    const rt = fakeRuntime({ classify: (t) => (t === 'second' ? new Promise<Model>((r) => (release = r)) : Promise.resolve('haiku')) });
    const h = hubWith(rt);
    await h.attach();
    await h.hub.send(h.id, 'first');
    await h.waitFor((e) => e.type === 'turn.completed');
    const pending = h.hub.send(h.id, 'second');
    await new Promise((r) => setTimeout(r, 10));
    rt.lives[0].exit();
    await h.waitFor((e) => e.type === 'session.state' && e.state === 'exited');
    release('sonnet');
    assert.equal(await pending, 'ok');
    await h.waitFor((e) => e.type === 'message.completed' && e.text === 'echo: second');
    assert.equal(rt.lives.length, 2);
    assert.deepEqual(rt.lives[1].models, ['sonnet']);
  });
});

describe('error log', () => {
  test('a session error gets an errorId and one entry in today\'s file, with project and recent events', async () => {
    const rt = fakeRuntime({ onSend: (_t, l: FakeLive) => l.out.push({ type: 'error', code: 'runtime', message: 'boom' }) });
    const h = hubWith(rt, false);
    await h.attach();
    await h.hub.send(h.id, 'trigger');
    const ev = await h.waitFor((e) => e.type === 'error');
    assert.ok(ev.type === 'error' && ev.errorId);
    await new Promise((r) => setTimeout(r, 50)); // appends are async
    const entries = (await readLogs(logDay())).filter((e) => e.id === (ev.type === 'error' ? ev.errorId : ''));
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.equal(entry.sessionId, h.id);
    assert.equal(entry.projectName, 'Test project');
    assert.equal(entry.message, 'boom');
    const recent = (entry.context?.recentEvents ?? []) as Array<{ type: string }>;
    assert.ok(recent.some((r) => r.type === 'user.message'));
  });

  test('crash: the error survives the recovery snapshot (re-sent with the same id, logged once)', async () => {
    const rt = fakeRuntime({ onSend: (_t, l: FakeLive) => { l.out.push({ type: 'error', code: 'exit', message: 'process exited with code 1' }); l.exit(); } });
    const h = hubWith(rt, false);
    await h.attach();
    await h.hub.send(h.id, 'crash');
    const first = await h.waitFor((e) => e.type === 'error');
    const errorId = first.type === 'error' ? first.errorId : undefined;
    const snapIdx = () => h.msgs.findLastIndex((m) => m.type === 'snapshot');
    await h.waitFor((e) => e.type === 'error' && e.seq > first.seq);
    const again = h.msgs.slice(snapIdx()).find((m) => m.type === 'event' && m.event.type === 'error');
    assert.ok(snapIdx() > 0, 'recovery snapshot sent');
    assert.ok(again && again.type === 'event' && again.event.type === 'error' && again.event.errorId === errorId);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await readLogs(logDay())).filter((e) => e.id === errorId).length, 1);
  });

  test('daily file: created on the first entry, appended after; torn lines skipped', async () => {
    const a = logError({ level: 'warn', source: 'ws', message: 'a' });
    const b = logError({ level: 'error', source: 'http', message: 'b' });
    await new Promise((r) => setTimeout(r, 50));
    const file = path.join(process.env.CCUI_DATA_DIR!, 'logs', `${logDay()}.jsonl`);
    writeFileSync(file, readFileSync(file, 'utf8') + '{"torn', { flag: 'w' });
    const ids = (await readLogs(logDay())).map((e) => e.id);
    assert.ok(ids.includes(a) && ids.includes(b));
    assert.deepEqual(await logDays(), [logDay()]);
    assert.deepEqual(await readLogs('../../etc/passwd'), []);
  });
});

describe('SDK message mapping', () => {
  const map = (m: unknown) => mapMessage(m as SDKMessage);
  test('compaction start / end / failure', () => {
    assert.deepEqual(map({ type: 'system', subtype: 'status', status: 'compacting' }), [{ type: 'compact', phase: 'started' }]);
    assert.deepEqual(map({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 120_000, post_tokens: 9_000 } }),
      [{ type: 'compact', phase: 'done', preTokens: 120_000, postTokens: 9_000 }]);
    assert.deepEqual(map({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'nope' }), [{ type: 'compact', phase: 'failed', message: 'nope' }]);
  });
  test('assistant text and result', () => {
    assert.deepEqual(map({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'hi' }] } }), [{ type: 'message.completed', text: 'hi' }]);
    const r = map({ type: 'result', subtype: 'success', is_error: false, result: 'hi', total_cost_usd: 0.5, usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 }, modelUsage: {} });
    assert.equal(r[0].type, 'turn.completed');
    assert.equal(r.length, 1);
  });
});

describe('background tasks tracker', () => {
  const sys = (m: object) => ({ type: 'system', ...m }) as unknown as SDKMessage;
  test('backgrounded Bash: listed, output file from the placeholder result, ends on notification', () => {
    const bg = new BgTasks();
    assert.equal(bg.apply(sys({ subtype: 'task_started', task_id: 'b1', tool_use_id: 'tu1', task_type: 'local_bash', description: 'Run suite', is_backgrounded: true })), true);
    bg.toolResult('tu1', 'Command running in background with ID: b1. Output is being written to: /tmp/x/tasks/b1.output');
    assert.equal(bg.outputFile('b1'), '/tmp/x/tasks/b1.output');
    assert.equal(bg.list()[0].status, 'running');
    assert.equal(bg.apply(sys({ subtype: 'task_notification', task_id: 'b1', status: 'completed', output_file: '/tmp/x/tasks/b1.output', summary: 'exit 0' })), true);
    const [t] = bg.list();
    assert.equal(t.status, 'completed');
    assert.equal(t.summary, 'exit 0');
    assert.ok(t.endedAt);
    assert.equal('outputFile' in t, false); // the path never goes to the client
  });
  test('foreground and ambient tasks are not listed; backgrounding later lists it; exit stops running ones', () => {
    const bg = new BgTasks();
    assert.equal(bg.apply(sys({ subtype: 'task_started', task_id: 'a1', tool_use_id: 'tu2', task_type: 'local_agent', description: 'agent' })), false);
    assert.equal(bg.apply(sys({ subtype: 'task_started', task_id: 'm1', task_type: 'monitor', description: 'watch', ambient: true })), false);
    assert.deepEqual(bg.list(), []);
    assert.equal(bg.apply(sys({ subtype: 'task_updated', task_id: 'a1', patch: { is_backgrounded: true } })), true);
    assert.equal(bg.apply(sys({ subtype: 'background_tasks_changed', tasks: [{ task_id: 'a1', task_type: 'local_agent', description: 'agent' }] })), false);
    assert.equal(bg.stopAll(), true);
    assert.deepEqual(bg.list().map((t) => [t.taskId, t.status]), [['a1', 'stopped']]);
  });
  test('live set before task_started (real SDK order): stays listed and gets the tool_use_id', () => {
    const bg = new BgTasks();
    assert.equal(bg.apply(sys({ subtype: 'background_tasks_changed', tasks: [{ task_id: 'b2', task_type: 'local_bash', description: 'sleep' }] })), true);
    bg.apply(sys({ subtype: 'task_started', task_id: 'b2', tool_use_id: 'tu3', task_type: 'local_bash', description: 'sleep' }));
    assert.deepEqual(bg.list().map((t) => [t.taskId, t.toolUseId]), [['b2', 'tu3']]);
  });
});

// regression: a session whose first entry isn't a user prompt (it started with a slash command) was reported as
// missing, so a new process was started with `sessionId` instead of `resume` -> "Session ID … is already in use"
describe('local transport sessionExists', () => {
  const cfg = mkdtempSync(path.join(tmpdir(), 'ccui-test-claude-'));
  process.env.CLAUDE_CONFIG_DIR = cfg;
  const cwd = '/tmp/some/project';
  const dir = path.join(cfg, 'projects', encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  test('true for any existing jsonl, whatever its first line', async () => {
    const id = randomUUID();
    writeFileSync(path.join(dir, `${id}.jsonl`), '{"type":"queue-operation","operation":"enqueue","content":"/git-review"}\n');
    assert.equal(await localTransport.sessionExists(id, cwd), true);
  });
  test('false when missing or not a session id', async () => {
    assert.equal(await localTransport.sessionExists(randomUUID(), cwd), false);
    assert.equal(await localTransport.sessionExists('../../x', cwd), false);
  });
});

describe('history timestamps', () => {
  const jsonl = '{"type":"user","uuid":"u1","timestamp":"2026-10-05T12:25:10.000Z","message":{"content":"hi"}}\n{"type":"assistant","uuid":"a1","timestamp":"2026-10-05T12:25:20.000Z","message":{"content":[{"type":"text","text":"yo"}]}}\n{"type":"user","message":{"content":"no ts"}}\n';
  test('parseHistory carries the entry timestamp (absent when missing)', () => {
    const h = parseHistory(jsonl);
    assert.equal(h[0].ts, Date.parse('2026-10-05T12:25:10.000Z'));
    assert.equal(h[2].ts, undefined);
  });
  test('jsonlTimestamps maps uuid to epoch ms', () => {
    assert.equal(jsonlTimestamps(jsonl).get('a1'), Date.parse('2026-10-05T12:25:20.000Z'));
  });
});

describe('session log', () => {
  test('appends in order and reads back; an unknown or invalid id yields nothing', async () => {
    const id = randomUUID();
    recordSession(id, 'a', { n: 1 });
    recordSession(id, 'b', { n: 2 });
    recordSession('../../etc/passwd', 'x'); // never becomes a path
    await flushSessionLog();
    const lines = await readSessionLog(id);
    assert.deepEqual(lines.map((l) => [l.kind, l.n]), [['a', 1], ['b', 2]]);
    assert.deepEqual(await readSessionLog(randomUUID()), []);
    assert.deepEqual(await readSessionLog('../../etc/passwd'), []);
  });

  const kinds = async (id: string) => (await readSessionLog(id)).map((l) => l.kind);
  test('hub records events (not deltas), routing verdict, process open/exit and who asked for /compact', async () => {
    const rt = fakeRuntime({ classify: async () => 'haiku' });
    const h = hubWith(rt);
    await h.attach();
    await h.hub.send(h.id, 'o que é isso?');
    await h.waitFor((e) => e.type === 'turn.completed');
    await h.hub.send(h.id, '/compact', [], 'auto-compact');
    await h.waitFor((e) => e.type === 'turn.completed' && e.seq > 8);
    await h.hub.send(h.id, '/compact');
    h.hub.compactDeclined(h.id, 71);
    await h.hub.interrupt(h.id);
    rt.lives[0].exit();
    await h.waitFor((e) => e.type === 'session.state' && e.state === 'exited');
    await flushSessionLog();
    const lines = await readSessionLog(h.id);
    assert.ok(!lines.some((l) => l.kind === 'message.delta'));
    const k = await kinds(h.id);
    for (const want of ['routing.classified', 'process.open', 'user.message', 'turn.completed', 'compact.requested', 'compact.declined', 'action', 'process.exit']) assert.ok(k.includes(want), want);
    assert.deepEqual(lines.filter((l) => l.kind === 'compact.requested').map((l) => l.by), ['deck-auto', 'user']);
    assert.equal(lines.find((l) => l.kind === 'routing.classified')?.source, 'heuristic');
    assert.equal(lines.find((l) => l.kind === 'process.open')?.resumed, undefined); // the fake has no resume notion
    assert.equal(lines.find((l) => l.kind === 'action')?.action, 'interrupt');
  });
});

describe('secret masking', () => {
  const c = () => ({} as Record<string, number>);
  const cases: Array<[string, string, string]> = [
    ['anthropic key', 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', 'anthropic-key'],
    ['github token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github-token'],
    ['aws key', 'AKIAABCDEFGHIJKLMNOP', 'aws-key'],
    ['bearer', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz', 'bearer'],
    ['env line', 'DB_PASSWORD=hunter2hunter2\nOTHER=1', 'env-secret'],
    ['json key', '{"apiKey": "abcdef123456"}', 'json-secret'],
    ['url credentials', 'postgres://user:s3cr3tpass@host/db', 'url-credentials'],
    ['private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----', 'private-key'],
  ];
  for (const [name, text, type] of cases) {
    test(`masks ${name}`, () => {
      const counts = c();
      const out = redactString(text, counts);
      assert.ok(out.includes(`[REDACTED:${type}]`), out);
      assert.equal(counts[type], 1);
    });
  }
  test('keeps what surrounds a bearer/env/url secret and leaves ordinary text alone', () => {
    const counts = c();
    assert.equal(redactString('Bearer abcdefghijklmnopqrstuvwxyz', counts), 'Bearer [REDACTED:bearer]');
    assert.equal(redactString('postgres://user:s3cr3tpass@host/db', counts), 'postgres://user:[REDACTED:url-credentials]@host/db');
    const plain = 'the token is stored in the keychain; run npm test and read docs/testing.md';
    assert.equal(redactString(plain, c()), plain);
  });
  test('redactDeep masks a string under a secret-looking key and copies, not mutates', () => {
    const input = { env: { GITHUB_TOKEN: 'abcdef123456', PATH: '/usr/bin' }, list: ['ok'] };
    const counts = c();
    const out = redactDeep(input, counts);
    assert.equal(out.env.GITHUB_TOKEN, '[REDACTED:secret-field]');
    assert.equal(out.env.PATH, '/usr/bin');
    assert.equal(input.env.GITHUB_TOKEN, 'abcdef123456');
  });
});

describe('session export', () => {
  const ts = (n: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, n)).toISOString();
  const row = (o: Record<string, unknown>) => JSON.stringify(o);
  const usage = (i: number, o: number, cr: number, cc: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc, output_tokens_details: { thinking_tokens: 3 } });
  const main = [
    row({ type: 'mode', mode: 'x' }),
    row({ type: 'attachment', timestamp: ts(0), attachment: { type: 'hook_success', hookName: 'SessionStart:startup', toolUseID: 'h1', command: 'run-hook session-start', stdout: 'x'.repeat(400), durationMs: 120 } }),
    row({ type: 'attachment', timestamp: ts(0), attachment: { type: 'hook_additional_context', hookName: 'SessionStart', toolUseID: 'h1', content: 'y'.repeat(800) } }),
    row({ type: 'attachment', timestamp: ts(0), attachment: { type: 'skill_listing', content: 'z'.repeat(400), skillCount: 3 } }),
    row({ type: 'user', timestamp: ts(1), message: { role: 'user', content: 'faz algo com GITHUB_TOKEN=abcdef123456' } }),
    // one API message split across two transcript lines: its usage must count once
    row({ type: 'assistant', timestamp: ts(2), message: { id: 'm1', model: 'sonnet', usage: usage(10, 20, 1000, 100), content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'superpowers:brainstorming' } }] } }),
    row({ type: 'assistant', timestamp: ts(2), message: { id: 'm1', model: 'sonnet', usage: usage(10, 20, 1000, 100), content: [{ type: 'tool_use', id: 't2', name: 'mcp__plugin_claude-mem_mcp-search__search', input: { q: 'a' } }] } }),
    row({ type: 'user', timestamp: ts(3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'skill body'.repeat(50) }, { type: 'tool_result', tool_use_id: 't2', content: 'hits' }] } }),
    row({ type: 'assistant', timestamp: ts(4), message: { id: 'm2', model: 'haiku', usage: usage(5, 7, 2000, 0), content: [{ type: 'tool_use', id: 't3', name: 'Agent', input: { subagent_type: 'Explore', prompt: 'p' } }, { type: 'text', text: 'ok' }] } }),
    row({ type: 'system', subtype: 'compact_boundary', timestamp: ts(5), content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 900, postTokens: 90 } }),
    row({ type: 'cost-state', totalCostUSD: 0.5, modelUsage: {} }),
  ].join('\n');
  const sub = [row({ type: 'assistant', timestamp: ts(4), message: { id: 'm3', model: 'haiku', usage: usage(1, 2, 3, 4), content: [{ type: 'tool_use', id: 's1', name: 'Bash', input: { command: 'ls' } }] } })].join('\n');
  const deck = [
    { ts: ts(1), kind: 'user.message', text: 'dup' },
    { ts: ts(1), kind: 'routing.classified', model: 'haiku', source: 'haiku', costUsd: 0.002, durationMs: 800 },
    { ts: ts(4), kind: 'compact.requested', by: 'deck-auto' },
    { ts: ts(4), kind: 'compact', phase: 'started', by: 'deck-auto' },
  ];
  const build = (redact: boolean, transcript = true) => {
    const lines = buildExport({
      session: { sessionId: 's', name: 'demo', settings: {} }, deckLog: deck, redact,
      transcript: transcript ? { main, subagents: [{ id: 'agent-1', meta: '{"agentType":"Explore","description":"d"}', jsonl: sub }] } : null,
    }).trim().split('\n').map((l) => JSON.parse(l));
    return { manifest: lines[0], timeline: lines.slice(1) };
  };

  test('manifest: origins, real tokens deduplicated by message id, cache ratio, compactions, routing, drops', () => {
    const { manifest: m } = build(true);
    const by = Object.fromEntries(m.byOrigin.map((o: { origin: string }) => [o.origin, o]));
    assert.equal(by['skill:superpowers:brainstorming'].calls, 1);
    assert.equal(by['skill:superpowers:brainstorming'].plugin, 'superpowers');
    assert.ok(by['skill:superpowers:brainstorming'].bytes > 400); // the tool_result body is attributed to the skill
    assert.equal(by['mcp:plugin_claude-mem_mcp-search'].plugin, 'claude-mem');
    assert.equal(by['subagent:Explore'].calls, 1);
    assert.equal(by['tool:Bash'].calls, 1); // from the subagent transcript
    assert.ok(by['system:skill_listing'].bytes >= 400);
    const hook = m.byOrigin.find((o: { origin: string }) => o.origin.startsWith('hook:SessionStart:startup'));
    assert.equal(hook.calls, 1); assert.equal(hook.durationMs, 120); assert.equal(hook.bytes, 0); // hook_success output overlaps the injected context
    assert.ok(m.byOrigin.some((o: { origin: string; bytes: number }) => o.origin.startsWith('hook:SessionStart') && o.bytes >= 800));
    assert.equal(m.tokens.total.messages, 3); // m1 once, m2, m3
    assert.equal(m.tokens.total.input, 10 + 5 + 1);
    assert.equal(m.tokens.total.cacheRead, 1000 + 2000 + 3);
    assert.equal(m.tokens.byModel.sonnet.messages, 1);
    assert.equal(m.tokens.byAgent['agent-1'].messages, 1);
    assert.equal(m.tokens.cacheHitRatio, Number((3003 / (3003 + 104 + 16)).toFixed(4)));
    assert.deepEqual(m.compactions.map((c: Record<string, unknown>) => c.src + ':' + (c.event ?? 'boundary')), ['deck:compact.requested', 'deck:compact', 'claude:boundary']);
    assert.equal(m.routing.calls, 1); assert.equal(m.routing.costUsd, 0.002);
    assert.equal(m.dropped.mode, 1);
    assert.equal(m.dropped['deck:duplicated-in-transcript'], 1);
    assert.equal(m.sources.subagents[0].agentType, 'Explore');
    assert.equal(m.costState.totalCostUSD, 0.5);
  });

  test('timeline: Deck and transcript lines interleaved by time, subagent lines tagged, duplicates dropped only with a transcript', () => {
    const { timeline } = build(true);
    const times = timeline.map((l: { ts: string }) => l.ts);
    assert.deepEqual(times, [...times].sort());
    assert.ok(timeline.some((l: { src: string; agent?: string }) => l.src === 'claude' && l.agent === 'agent-1'));
    assert.ok(!timeline.some((l: { kind?: string }) => l.kind === 'user.message'));
    assert.ok(build(true, false).timeline.some((l: { kind?: string }) => l.kind === 'user.message')); // no transcript: the Deck copy is all there is
    assert.equal(build(true, false).manifest.sources.transcriptAvailable, false);
  });

  test('masking: on by default (and counted), off keeps the text', () => {
    const on = JSON.stringify(build(true).timeline);
    assert.ok(!on.includes('abcdef123456'));
    assert.equal(build(true).manifest.redaction.counts['env-secret'], 1);
    assert.ok(JSON.stringify(build(false).timeline).includes('abcdef123456'));
    assert.equal(build(false).manifest.redaction.enabled, false);
  });
});

describe('remote transcript parsing', () => {
  test('splits the main jsonl from the marked subagent files and pairs meta with jsonl', () => {
    const out = `{"a":1}\n{"a":2}\n${FILE_MARK}s/subagents/agent-x.jsonl\n{"b":1}\n\n${FILE_MARK}s/subagents/agent-x.meta.json\n{"agentType":"Explore"}`;
    const r = parseRemoteTranscript(out);
    assert.equal(r.main, '{"a":1}\n{"a":2}');
    assert.equal(r.subagents.length, 1);
    assert.equal(r.subagents[0].id, 'agent-x');
    assert.equal(r.subagents[0].jsonl.trim(), '{"b":1}');
    assert.equal(r.subagents[0].meta, '{"agentType":"Explore"}');
  });
});
