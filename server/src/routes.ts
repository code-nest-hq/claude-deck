import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  createConnectionBody, createProfileBody, createProjectBody, createSessionBody, lastConnectionBody, loginCodeBody, patchConfigBody, patchProjectBody, patchSessionBody, uuidSchema,
  type Connection, type Project, type SessionMeta, type SessionStatus, type SlashCommandInfo,
} from '@ccui/shared';
import { versionWarning, type Connections } from './connections';
import { ensureMeta, listProjectSessions, openSpecFor } from './domain';
import { parseGitStatus } from './git';
import { logDay, logDays, readLogs } from './logs';
import { activate, DEFAULT_PROFILE, knownProfile, listProfiles, logout, removeProfile, sendCode, startLogin, usageFor } from './profiles';
import type { SessionHub } from './hub';
import { todayDelta } from './runtime/jsonl';
import { checkConnection, validClaudePath, validTarget } from './ssh-util';
import type { Store } from './store';

interface Deps { store: Store; hub: SessionHub; conns: Connections }

const body = async <T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T> | null> => {
  const r = schema.safeParse(await c.req.json().catch(() => null));
  return r.success ? r.data : null;
};

export function buildApi({ store, hub, conns }: Deps) {
  const api = new Hono();
  const projects = () => store.projects.data.projects;
  const connections = () => store.config.data.connections;
  const project = (id: string) => projects().find((p) => p.id === id);
  const bad = (c: Context, msg: string) => c.json({ error: msg }, 400);

  // daily error log (Logs page): ?day=YYYY-MM-DD, default today; `days` lists the days that have a file
  api.get('/logs', async (c) => {
    const day = c.req.query('day') ?? logDay();
    return c.json({ day, days: await logDays(), entries: await readLogs(day) });
  });

  api.get('/state', (c) => c.json({ config: store.config.data, projects: projects(), status: conns.all() }));

  // agregação de gastos de hoje, todas as conexões/projetos/sessões (janela de leitura limitada, ver Transport.costCheckpoints)
  api.get('/usage/today', async (c) => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let totalCostUsd = 0;
    const byModel: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    for (const p of projects()) {
      const rt = conns.get(p.connectionId);
      const sessions = await rt.runtime.listSessions(p.path).catch(() => []);
      for (const s of sessions) {
        const checkpoints = await rt.transport.costCheckpoints(s.sessionId, p.path).catch(() => null);
        if (!checkpoints) continue;
        const delta = todayDelta(checkpoints, todayStart.getTime());
        if (delta.totals.costUsd <= 0) continue;
        totalCostUsd += delta.totals.costUsd;
        byProject[p.id] = (byProject[p.id] ?? 0) + delta.totals.costUsd;
        for (const [model, u] of Object.entries(delta.modelUsage)) byModel[model] = (byModel[model] ?? 0) + u.costUsd;
      }
    }
    return c.json({ totalCostUsd, byModel, byProject });
  });

  // padrões globais (modelo/effort/limite de gasto por sessão), configuráveis em runtime pela UI de configurações
  api.patch('/config', async (c) => {
    const b = await body(c, patchConfigBody);
    if (!b) return bad(c, 'dados inválidos');
    Object.assign(store.config.data.defaults, b);
    await store.config.save();
    return c.json(store.config.data);
  });

  api.post('/last-connection', async (c) => {
    const b = await body(c, lastConnectionBody);
    if (!b || !connections().some((x) => x.id === b.connectionId)) return bad(c, 'conexão inválida');
    store.config.data.lastConnectionId = b.connectionId;
    await store.config.save();
    return c.body(null, 204);
  });

  // valida target/claudePath e testa a conexão real (ssh + claude --version); não salva nada
  const probe = async (c: Context) => {
    const b = await body(c, createConnectionBody);
    if (!b) return { err: bad(c, 'dados inválidos') };
    if (!validTarget(b.target)) return { err: bad(c, 'destino inválido: use usuario@host') };
    if (b.claudePath !== undefined && !validClaudePath(b.claudePath)) return { err: bad(c, 'caminho do claude inválido') };
    const r = await checkConnection(b.target, b.claudePath);
    return { b, r };
  };

  api.post('/connections/test', async (c) => {
    const p = await probe(c);
    if (p.err) return p.err;
    return c.json(p.r.ok ? { ok: true, version: p.r.version, warning: versionWarning(p.r.version) } : { ok: false, error: p.r.error });
  });

  api.post('/connections', async (c) => {
    const p = await probe(c);
    if (p.err) return p.err;
    if (!p.r.ok) return bad(c, p.r.error);
    if (connections().some((x) => x.target === p.b.target)) return c.json({ error: 'servidor já cadastrado' }, 409);
    const conn: Connection = {
      id: 'ssh-' + p.b.target.replace(/[^A-Za-z0-9]/g, '-'), kind: 'ssh', target: p.b.target, label: p.b.label ?? p.b.target,
      ...(p.b.claudePath ? { claudePath: p.b.claudePath } : {}),
    };
    connections().push(conn);
    await store.config.save();
    conns.markUp(conn.id);
    return c.json({ connection: conn, warning: versionWarning(p.r.version) });
  });

  // remove só metadata nossa; sessões vivas dessa conexão terminam sozinhas (Fase 3: encerrar ao remover)
  api.delete('/connections/:id', async (c) => {
    const id = c.req.param('id');
    if (id === 'local') return bad(c, 'a conexão local não pode ser removida');
    const doomed = new Set(projects().filter((p) => p.connectionId === id).map((p) => p.id));
    store.config.data.connections = connections().filter((x) => x.id !== id);
    if (store.config.data.lastConnectionId === id) store.config.data.lastConnectionId = 'local';
    store.projects.data.projects = projects().filter((p) => !doomed.has(p.id));
    store.sessions.data.sessions = store.sessions.data.sessions.filter((s) => !doomed.has(s.projectId));
    conns.drop(id);
    await Promise.all([store.config.save(), store.projects.save(), store.sessions.save()]);
    return c.body(null, 204);
  });

  // navega o filesystem da conexão (pastas locais/SSH) pra escolher caminho de projeto sem digitar
  api.get('/connections/:id/browse', async (c) => {
    let conn: ReturnType<Connections['get']>;
    try { conn = conns.get(c.req.param('id')); } catch { return c.json({ error: 'conexão desconhecida' }, 404); }
    const raw = c.req.query('path');
    let p: string | null = null;
    if (raw !== undefined) {
      p = path.posix.normalize(raw);
      if (!p.startsWith('/') || /[\u0000-\u001f]/.test(p)) return bad(c, 'caminho inválido');
    }
    const r = await conn.transport.listDir(p);
    if (!r) return c.json({ error: 'não foi possível listar este caminho' }, 404);
    const kind = c.req.query('kind') === 'all' ? 'all' : 'dir';
    return c.json({ path: r.path, entries: kind === 'dir' ? r.entries.filter((e) => e.isDir) : r.entries });
  });

  api.post('/projects', async (c) => {
    const b = await body(c, createProjectBody);
    if (!b) return bad(c, 'dados inválidos');
    if (!connections().some((x) => x.id === b.connectionId)) return bad(c, 'conexão inválida');
    // caminhos POSIX (local Linux/macOS e remoto Linux); sem caracteres de controle
    const p = path.posix.normalize(b.path);
    if (!p.startsWith('/') || /[\u0000-\u001f]/.test(p)) return bad(c, 'o caminho deve ser absoluto');
    if (!(await conns.get(b.connectionId).transport.isDirectory(p))) return bad(c, 'diretório não encontrado');
    if (projects().some((x) => x.connectionId === b.connectionId && x.path === p)) return c.json({ error: 'projeto já cadastrado' }, 409);
    const created: Project = { id: randomUUID(), name: b.name, connectionId: b.connectionId, path: p, lean: b.lean };
    projects().push(created);
    await store.projects.save();
    return c.json(created);
  });

  api.patch('/projects/:id', async (c) => {
    const p = project(c.req.param('id'));
    const b = await body(c, patchProjectBody);
    if (!p || !b) return bad(c, 'dados inválidos');
    Object.assign(p, b);
    await store.projects.save();
    return c.json(p);
  });

  // remove só metadata nossa; nunca toca no jsonl do Claude
  api.delete('/projects/:id', async (c) => {
    const id = c.req.param('id');
    store.projects.data.projects = projects().filter((p) => p.id !== id);
    store.sessions.data.sessions = store.sessions.data.sessions.filter((s) => s.projectId !== id);
    await Promise.all([store.projects.save(), store.sessions.save()]);
    return c.body(null, 204);
  });

  api.get('/projects/:id/sessions', async (c) => {
    const p = project(c.req.param('id'));
    if (!p) return c.json({ error: 'projeto desconhecido' }, 404);
    return c.json(await listProjectSessions(store, conns.get(p.connectionId).runtime, hub, p));
  });

  // custo acumulado do projeto (todas as sessões) + últimas 5 com custo individual (reusa Transport.usage(), já existente)
  api.get('/projects/:id/usage', async (c) => {
    const p = project(c.req.param('id'));
    if (!p) return c.json({ error: 'projeto desconhecido' }, 404);
    const rt = conns.get(p.connectionId);
    const disk = await rt.runtime.listSessions(p.path).catch(() => []);
    const metas = new Map(store.sessions.data.sessions.filter((s) => s.projectId === p.id).map((m) => [m.sessionId, m]));
    let totalCostUsd = 0;
    const rows = await Promise.all(disk.map(async (d) => {
      const u = await rt.transport.usage(d.sessionId, p.path).catch(() => null);
      const costUsd = u?.totals.costUsd ?? 0;
      totalCostUsd += costUsd;
      const meta = metas.get(d.sessionId);
      return { sessionId: d.sessionId, name: meta?.name ?? d.customTitle ?? d.summary ?? '(sem título)', lastModified: d.lastModified, costUsd };
    }));
    rows.sort((a, b) => b.lastModified - a.lastModified);
    return c.json({ totalCostUsd, sessions: rows.slice(0, 5) });
  });

  // comandos `/` do projeto para o autocomplete; cache de 5 min por (projeto, lean); falha => lista vazia (a UI tenta de novo depois)
  const cmdCache = new Map<string, { at: number; list: SlashCommandInfo[] }>();
  const cmdInflight = new Map<string, Promise<SlashCommandInfo[]>>();
  api.get('/projects/:id/commands', async (c) => {
    const p = project(c.req.param('id'));
    if (!p) return c.json({ error: 'projeto desconhecido' }, 404);
    const key = `${p.id}:${p.lean}`;
    const hit = cmdCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return c.json(hit.list);
    let job = cmdInflight.get(key);
    if (!job) {
      job = conns.get(p.connectionId).runtime.commands(p.path, p.lean).finally(() => cmdInflight.delete(key));
      cmdInflight.set(key, job);
    }
    try {
      const list = await job;
      cmdCache.set(key, { at: Date.now(), list });
      return c.json(list);
    } catch { return c.json([]); }
  });

  // "Refresh" button: reloads skills/plugins into the live session and drops the cached `/` list so the next fetch sees them
  api.post('/projects/:id/sessions/:sid/reload', async (c) => {
    const p = project(c.req.param('id'));
    const sid = uuidSchema.safeParse(c.req.param('sid'));
    if (!p || !sid.success) return c.json({ error: 'projeto/sessão desconhecido' }, 404);
    cmdCache.delete(`${p.id}:${p.lean}`);
    try {
      const r = await hub.reload(sid.data);
      if (r === 'busy') return c.json({ error: 'wait for the current turn to finish' }, 409);
      return c.json({ live: !!r, ...(r ?? {}) });
    } catch (e) { return bad(c, (e as Error).message); }
  });

  // Status modal: effective settings resolved exactly like the process opens (openSpecFor)
  api.get('/projects/:id/sessions/:sid/status', (c) => {
    const sid = uuidSchema.safeParse(c.req.param('sid'));
    const meta = sid.success ? store.sessions.data.sessions.find((s) => s.sessionId === sid.data && s.projectId === c.req.param('id')) : undefined;
    if (!meta) return c.json({ error: 'projeto/sessão desconhecido' }, 404);
    const { cwd: _cwd, ...spec } = openSpecFor(store, meta.sessionId);
    return c.json({ meta, live: hub.isLive(meta.sessionId), ...spec } satisfies SessionStatus);
  });

  // branch/status do Git do projeto (null quando não é um repositório ou o servidor não responde)
  api.get('/projects/:id/git', async (c) => {
    const p = project(c.req.param('id'));
    if (!p) return c.json({ error: 'projeto desconhecido' }, 404);
    const out = await conns.get(p.connectionId).transport.git(p.path);
    return c.json(out === null ? null : parseGitStatus(out));
  });

  api.post('/projects/:id/sessions', async (c) => {
    const p = project(c.req.param('id'));
    const b = await body(c, createSessionBody);
    if (!p || !b) return bad(c, 'dados inválidos');
    const now = Date.now();
    const meta: SessionMeta = { sessionId: randomUUID(), projectId: p.id, name: b.name, model: b.model, effort: b.effort, routing: b.routing, createdAt: now, lastUsedAt: now };
    store.sessions.data.sessions.push(meta);
    await store.sessions.save();
    return c.json(meta);
  });

  api.patch('/sessions/:id', async (c) => {
    const id = uuidSchema.safeParse(c.req.param('id'));
    const b = await body(c, patchSessionBody);
    if (!id.success || !b) return bad(c, 'dados inválidos');
    try { await ensureMeta(store, id.data, b.projectId); } catch (e) { return bad(c, (e as Error).message); }
    const meta = store.sessions.data.sessions.find((s) => s.sessionId === id.data)!;
    if (b.name !== undefined) meta.name = b.name;
    if (b.favorite !== undefined) meta.favorite = b.favorite;
    if (b.archived !== undefined) meta.archived = b.archived;
    if (b.tags !== undefined) meta.tags = [...new Set(b.tags)];
    await store.sessions.save();
    return c.body(null, 204);
  });

  // Claude account profiles (local sessions only), see profiles.ts
  api.get('/profiles', async (c) => c.json(await listProfiles(store)));

  api.post('/profiles', async (c) => {
    const b = await body(c, createProfileBody);
    if (!b) return bad(c, 'dados inválidos');
    const created = { id: randomUUID(), name: b.name };
    (store.config.data.profiles ??= []).push(created);
    await store.config.save();
    await startLogin(created.id);
    return c.json(created);
  });

  const profileAction = (fn: (id: string, c: Context) => Promise<Response>) => async (c: Context) => {
    const id = c.req.param('id') ?? '';
    if (!knownProfile(store, id)) return c.json({ error: 'perfil desconhecido' }, 404);
    try { return await fn(id, c); } catch (e) { return bad(c, (e as Error).message); }
  };
  api.post('/profiles/:id/activate', profileAction(async (id, c) => { await activate(store, id); return c.body(null, 204); }));
  api.post('/profiles/:id/login', profileAction(async (id, c) => { await startLogin(id); return c.body(null, 204); }));
  api.post('/profiles/:id/login/code', profileAction(async (id, c) => {
    const b = await body(c, loginCodeBody);
    if (!b) return bad(c, 'dados inválidos');
    return sendCode(id, b.code) ? c.body(null, 204) : bad(c, 'nenhum login em andamento');
  }));
  api.get('/profiles/:id/usage', profileAction(async (id, c) => c.json(await usageFor(id))));
  api.post('/profiles/:id/logout',profileAction(async (id, c) => { await logout(id); return c.body(null, 204); }));
  api.delete('/profiles/:id', profileAction(async (id, c) => {
    if (id === DEFAULT_PROFILE) return bad(c, 'o perfil padrão não pode ser removido');
    await removeProfile(store, id);
    return c.body(null, 204);
  }));

  return api;
}
