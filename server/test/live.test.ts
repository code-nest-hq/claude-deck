// Talks to the real Claude Code through the Agent SDK (spends a few cents of Haiku/Sonnet): `npm run test:live`.
// Needs a logged-in `claude`. Runs in a throwaway project dir; the sessions it creates are deleted at the end.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import type { EventBody, Model } from '@ccui/shared';
import { recorder } from './fakes';

const live = process.env.CCUI_LIVE === '1';
process.env.CCUI_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ccui-live-data-'));
const { SessionHub } = await import('../src/hub');
const { SdkRuntime } = await import('../src/runtime/sdk-runtime');
const { localTransport } = await import('../src/runtime/local-transport');
const { encodeCwd } = await import('../src/ssh-util');

const cwd = mkdtempSync(path.join(tmpdir(), 'ccui-live-project-'));
const rt = new SdkRuntime(localTransport);
const base = { cwd, model: 'haiku' as Model, effort: 'low' as const, lean: true, routing: false, permissionMode: 'default' as const };
const TURN_MS = 120_000;

after(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), 'projects', encodeCwd(cwd)), { recursive: true, force: true });
});

// one turn on a live process: everything it emitted until the turn's context.usage (the last event of a turn)
async function turn(events: AsyncIterator<EventBody>, sendIt: () => void): Promise<EventBody[]> {
  sendIt();
  const got: EventBody[] = [];
  const deadline = Date.now() + TURN_MS;
  while (Date.now() < deadline) {
    const r = await events.next();
    if (r.done) break;
    got.push(r.value);
    if (r.value.type === 'context.usage') break;
  }
  return got;
}
const texts = (evs: EventBody[]) => evs.flatMap((e) => (e.type === 'message.completed' ? [e.text] : [])).join(' ');

describe('Claude Code via the Agent SDK', { skip: !live && 'set CCUI_LIVE=1 (npm run test:live)' }, () => {
  const sessionId = randomUUID();

  test('sends a message and gets the reply, turn totals and context usage back', { timeout: TURN_MS }, async () => {
    const s = await rt.open({ ...base, sessionId });
    try {
      const evs = await turn(s.events[Symbol.asyncIterator](), () => s.send('Reply with exactly the word PONG and nothing else.'));
      assert.match(texts(evs), /PONG/);
      const done = evs.find((e) => e.type === 'turn.completed');
      assert.ok(done && done.type === 'turn.completed' && done.outputTokens > 0, 'turn.completed with output tokens');
      const ctx = evs.find((e) => e.type === 'context.usage');
      assert.ok(ctx && ctx.type === 'context.usage' && ctx.totalTokens > 0 && ctx.maxTokens > 0, 'context.usage after the turn');
      assert.ok(!evs.some((e) => e.type === 'error'), `no error: ${JSON.stringify(evs.filter((e) => e.type === 'error'))}`);
    } finally { await s.close(); }
  });

  test('resumes the same session in a new process and remembers it', { timeout: TURN_MS }, async () => {
    assert.equal(await localTransport.sessionExists(sessionId, cwd), true);
    const s = await rt.open({ ...base, sessionId });
    try {
      const evs = await turn(s.events[Symbol.asyncIterator](), () => s.send('What single word did you reply with in your previous answer? Reply with just that word.'));
      assert.ok(!evs.some((e) => e.type === 'error'), `no error: ${JSON.stringify(evs.filter((e) => e.type === 'error'))}`);
      assert.match(texts(evs), /PONG/i);
    } finally { await s.close(); }
  });
});

describe('Model Routing classifier (Haiku call for gray-zone prompts)', { skip: !live && 'set CCUI_LIVE=1 (npm run test:live)' }, () => {
  const cases: Array<[string, Model]> = [
    ['Por que o céu é azul?', 'haiku'],
    ['Quanto é 2 + 2?', 'haiku'],
    ['O checkout está duplicando pedidos quando o pagamento demora; investiga a causa no backend e no frontend e ajusta o fluxo inteiro.', 'sonnet'],
    ['Preciso trocar a autenticação de sessão por JWT em todos os serviços, mantendo compatibilidade com os clientes atuais.', 'sonnet'],
  ];
  for (const [text, want] of cases) {
    test(`${JSON.stringify(text.slice(0, 60))} -> ${want}`, { timeout: 30_000 }, async () => {
      assert.equal(await rt.classify(cwd, text), want);
    });
  }
});

describe('SessionHub end to end (real Claude Code, routing on)', { skip: !live && 'set CCUI_LIVE=1 (npm run test:live)' }, () => {
  test('routing picks a model, the message reaches Claude and the reply comes back', { timeout: TURN_MS }, async () => {
    const hub = new SessionHub(() => rt, () => ({ ...base, routing: true }));
    const id = randomUUID();
    const r = recorder();
    await hub.attach(r.client, id);
    try {
      assert.equal(await hub.send(id, 'Reply with exactly the word PONG and nothing else.'), 'ok');
      await r.waitFor((e) => e.type === 'context.usage' || e.type === 'error', TURN_MS);
      const evs = r.events();
      assert.ok(!evs.some((e) => e.type === 'error'), `no error: ${JSON.stringify(evs.filter((e) => e.type === 'error'))}`);
      const order = evs.map((e) => e.type).filter((t) => ['routing.started', 'model.routed', 'user.message', 'message.completed', 'turn.completed'].includes(t));
      assert.deepEqual(order.slice(0, 3), ['routing.started', 'model.routed', 'user.message']);
      assert.ok(order.includes('turn.completed'));
      assert.match(evs.flatMap((e) => (e.type === 'message.completed' ? [e.text] : [])).join(' '), /PONG/);
    } finally { await hub.shutdown(); }
  });
});
