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
const { classifyHeuristic } = await import('../src/runtime/routing');
const { mapMessage } = await import('../src/runtime/events');
const { localTransport } = await import('../src/runtime/local-transport');
const { encodeCwd } = await import('../src/ssh-util');

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
  ];
  for (const [text, want] of cases) {
    test(`${JSON.stringify(text.slice(0, 50))} -> ${want ?? 'classifier'}`, () => assert.equal(classifyHeuristic(text), want));
  }
  test('a question that asks to build something goes to Sonnet (cost only saved when it is safe)', () => {
    assert.equal(classifyHeuristic('explica e depois implementa o cache'), 'sonnet');
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
