import type { Project, SessionRow } from '@ccui/shared';
import type { OpenSpec, SessionHub, SessionLabel } from './hub';
import type { ClaudeRuntime } from './runtime/types';
import type { Store } from './store';

export function openSpecFor(store: Store, sessionId: string): OpenSpec {
  const meta = store.sessions.data.sessions.find((s) => s.sessionId === sessionId);
  const project = meta && store.projects.data.projects.find((p) => p.id === meta.projectId);
  if (!meta || !project) throw new Error('sessão desconhecida');
  const d = store.config.data.defaults;
  return {
    cwd: project.path,
    model: meta.model ?? project.model ?? d.model,
    effort: meta.effort ?? project.effort ?? d.effort,
    lean: project.lean,
    routing: meta.routing ?? project.routing ?? false,
    permissionMode: project.bypass ? 'bypassPermissions' : 'default',
  };
}

// sessões vindas do terminal ganham uma linha de meta ao serem abertas pela UI
export async function ensureMeta(store: Store, sessionId: string, projectId: string) {
  if (store.sessions.data.sessions.some((s) => s.sessionId === sessionId)) return;
  if (!store.projects.data.projects.some((p) => p.id === projectId)) throw new Error('projeto desconhecido');
  const now = Date.now();
  store.sessions.data.sessions.push({ sessionId, projectId, createdAt: now, lastUsedAt: now });
  await store.sessions.save();
}

export function touch(store: Store, sessionId: string) {
  const m = store.sessions.data.sessions.find((s) => s.sessionId === sessionId);
  if (m) { m.lastUsedAt = Date.now(); void store.sessions.save(); }
}

// união: disco (terminal + UI) ∪ metas da UI ainda sem jsonl
export async function listProjectSessions(store: Store, runtime: ClaudeRuntime, hub: SessionHub, project: Project): Promise<SessionRow[]> {
  const disk = await runtime.listSessions(project.path).catch(() => []);
  const metas = new Map(store.sessions.data.sessions.filter((s) => s.projectId === project.id).map((m) => [m.sessionId, m]));
  const rows = new Map<string, SessionRow>();
  for (const d of disk) {
    const m = metas.get(d.sessionId);
    rows.set(d.sessionId, {
      sessionId: d.sessionId,
      name: m?.name ?? d.customTitle ?? d.summary ?? d.firstPrompt ?? '(sem título)',
      lastModified: d.lastModified,
      live: hub.isLive(d.sessionId),
      tags: m?.tags ?? [], favorite: !!m?.favorite, archived: !!m?.archived,
    });
  }
  for (const m of metas.values()) {
    if (!rows.has(m.sessionId)) {
      rows.set(m.sessionId, {
        sessionId: m.sessionId, name: m.name ?? '(sem título)', lastModified: m.lastUsedAt, live: hub.isLive(m.sessionId),
        tags: m.tags ?? [], favorite: !!m.favorite, archived: !!m.archived,
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.lastModified - a.lastModified);
}

export function connectionIdFor(store: Store, sessionId: string): string {
  const meta = store.sessions.data.sessions.find((s) => s.sessionId === sessionId);
  const project = meta && store.projects.data.projects.find((p) => p.id === meta.projectId);
  if (!project) throw new Error('sessão desconhecida');
  return project.connectionId;
}

/** who a session belongs to, for the error log; never throws (the session may be unknown) */
export function sessionLabel(store: Store, sessionId: string): SessionLabel {
  const meta = store.sessions.data.sessions.find((s) => s.sessionId === sessionId);
  const project = meta && store.projects.data.projects.find((p) => p.id === meta.projectId);
  return { projectId: meta?.projectId, projectName: project?.name, sessionName: meta?.name, connectionId: project?.connectionId };
}
