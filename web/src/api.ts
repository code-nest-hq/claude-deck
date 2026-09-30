import type { Config, ConnStatus, Connection, DirEntry, Effort, GitInfo, Model, PlanUsage, ProfileView, Project, ProjectUsageView, SessionRow, SlashCommandInfo, TodayUsage } from '@ccui/shared';

const KEY = 'ccui-token';
let token: string | null = null;
export const getToken = () => token;

// o token chega em #token=… (fragmento não vai em logs nem Referer); guarda em memória + sessionStorage e limpa a URL
export function initToken(): string | null {
  const m = /token=([^&]+)/.exec(location.hash);
  if (m) {
    token = decodeURIComponent(m[1]);
    try { sessionStorage.setItem(KEY, token); } catch {}
    history.replaceState(null, '', location.pathname);
  } else if (!token) {
    try { token = sessionStorage.getItem(KEY); } catch {}
  }
  return token;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.status === 204 ? (undefined as T) : r.json();
}

export const api = {
  state: () => req<{ config: Config; projects: Project[]; status: Record<string, ConnStatus> }>('GET', '/api/state'),
  setConnection: (connectionId: string) => req<void>('POST', '/api/last-connection', { connectionId }),
  patchConfig: (b: Partial<{ model: Model; effort: Effort }>) => req<Config>('PATCH', '/api/config', b),
  addProject: (b: { name: string; path: string; lean: boolean; connectionId: string }) => req<Project>('POST', '/api/projects', b),
  testConnection: (b: { target: string; claudePath?: string }) => req<{ ok: boolean; version?: string; warning?: string; error?: string }>('POST', '/api/connections/test', b),
  addConnection: (b: { target: string; label?: string; claudePath?: string }) => req<{ connection: Connection; warning?: string }>('POST', '/api/connections', b),
  delConnection: (id: string) => req<void>('DELETE', `/api/connections/${id}`),
  patchProject: (id: string, b: Partial<Pick<Project, 'name' | 'lean' | 'routing' | 'bypass' | 'autoCompact' | 'model' | 'effort'>>) => req<Project>('PATCH', `/api/projects/${id}`, b),
  delProject: (id: string) => req<void>('DELETE', `/api/projects/${id}`),
  sessions: (pid: string) => req<SessionRow[]>('GET', `/api/projects/${pid}/sessions`),
  newSession: (pid: string, b: { name: string; model?: Model; effort?: Effort; routing?: boolean }) => req<{ sessionId: string }>('POST', `/api/projects/${pid}/sessions`, b),
  patchSession: (sid: string, projectId: string, b: { name?: string; favorite?: boolean; archived?: boolean; tags?: string[] }) => req<void>('PATCH', `/api/sessions/${sid}`, { projectId, ...b }),
  commands: (pid: string) => req<SlashCommandInfo[]>('GET', `/api/projects/${pid}/commands`),
  reload: (pid: string, sid: string) => req<{ live: boolean; plugins?: number; errors?: number }>('POST', `/api/projects/${pid}/sessions/${sid}/reload`),
  git: (pid: string) => req<GitInfo | null>('GET', `/api/projects/${pid}/git`),
  usageToday: () => req<TodayUsage>('GET', '/api/usage/today'),
  projectUsage: (id: string) => req<ProjectUsageView>('GET', `/api/projects/${id}/usage`),
  profiles: () => req<ProfileView[]>('GET', '/api/profiles'),
  addProfile: (name: string) => req<{ id: string; name: string }>('POST', '/api/profiles', { name }),
  profileAction: (id: string, action: 'activate' | 'login' | 'logout') => req<void>('POST', `/api/profiles/${id}/${action}`),
  profileUsage: (id: string) => req<PlanUsage>('GET', `/api/profiles/${id}/usage`),
  loginCode: (id: string, code: string) => req<void>('POST', `/api/profiles/${id}/login/code`, { code }),
  delProfile: (id: string) => req<void>('DELETE', `/api/profiles/${id}`),
  browse: (connectionId: string, path: string | null, kind: 'dir' | 'all' = 'dir') =>
    req<{ path: string; entries: DirEntry[] }>('GET', `/api/connections/${connectionId}/browse?${path ? `path=${encodeURIComponent(path)}&` : ''}kind=${kind}`),
};
