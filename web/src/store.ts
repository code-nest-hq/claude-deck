import { create } from 'zustand';
import type { Config, ConnStatus, McpAction, Project, ServerMsg, SessionRow, SlashCommandInfo } from '@ccui/shared';
import { api, initToken } from './api';
import { addError, applyEvent, applySnapshot, emptyChat, type Chat } from './features/chat/reduce';
import { disableNotify, enableNotify, notify, notifyEnabled } from './notify';
import { createSocket } from './ws';

export interface Tab { projectId: string; sessionId: string }
export interface Ui { palette: boolean; help: boolean; newSession: boolean; newFor: string | null; term: boolean; settingsFor: string | null; appSettings: boolean; spend: boolean; profile: boolean }
export const SIDEBAR_W_MIN = 224;
export const SIDEBAR_W_MAX = 420;
export const SIDEBAR_W_DEFAULT = 288;
// preferências de layout lembradas entre execuções: barra lateral visível/largura e grupos/projetos recolhidos (chaves "c:<conexão>", "p:<projeto>", "f")
export interface Layout { sidebar: boolean; sidebarW: number; collapsed: Record<string, boolean> }
const LAYOUT_KEY = 'ccui-layout';
const clampW = (w: number) => Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, w));
const loadLayout = (): Layout => {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
    return {
      sidebar: v.sidebar !== false,
      sidebarW: typeof v.sidebarW === 'number' ? clampW(v.sidebarW) : SIDEBAR_W_DEFAULT,
      collapsed: v.collapsed && typeof v.collapsed === 'object' ? v.collapsed : {},
    };
  } catch { return { sidebar: true, sidebarW: SIDEBAR_W_DEFAULT, collapsed: {} }; }
};
const saveLayout = (l: Layout) => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); } catch { /* ignora */ } };
type SessionPatch = { name?: string; favorite?: boolean; archived?: boolean; tags?: string[] };

interface App {
  tokenMissing: boolean;
  up: boolean;
  config: Config | null;
  projects: Project[];
  rows: Record<string, SessionRow[]>;
  active: { projectId: string; sessionId: string } | null;
  tabs: Tab[];
  chats: Record<string, Chat>;
  status: Record<string, ConnStatus>;
  attention: Record<string, boolean>; // sessões que terminaram/pediram permissão fora de foco
  notifyOn: boolean;
  ui: Ui;
  layout: Layout;
  commands: Record<string, SlashCommandInfo[]>; // chave "<projeto>:<lean>"
  attachments: Record<string, string[]>; // sessionId -> caminhos absolutos ainda não enviados
  start(): Promise<void>;
  reloadProjects(): Promise<void>;
  refreshRows(projectId: string): Promise<void>;
  open(projectId: string, sessionId: string): void;
  closeTab(sessionId: string): void;
  cycleTab(dir: 1 | -1): void;
  patchSession(sessionId: string, projectId: string, patch: SessionPatch): Promise<void>;
  setUi(p: Partial<Ui>): void;
  toggleSidebar(): void;
  setSidebarW(w: number): void;
  toggleCollapsed(key: string): void;
  ensureCommands(projectId: string): Promise<void>;
  /** reloads skills/plugins into the active session and refetches the `/` list; resolves to a short status line */
  refreshSession(): Promise<string>;
  addAttachment(sessionId: string, path: string): void;
  removeAttachment(sessionId: string, path: string): void;
  toggleNotify(): Promise<void>;
  /** withFiles=false leaves the pending attachments for the next message (e.g. an automatic `/compact`) */
  send(text: string, withFiles?: boolean): void;
  interrupt(): void;
  shell(command: string): void;
  mcp(id?: string, action?: McpAction): void;
  answer(reqId: string, allow: boolean, updatedInput?: Record<string, unknown>): void;
  chooseConnection(connectionId: string): Promise<void>;
}

let sock: ReturnType<typeof createSocket> | null = null;
let started = false; // StrictMode roda efeitos duas vezes em dev
const attached = new Map<string, string>(); // sessionId -> projectId (re-attach ao reconectar)
const loadingCommands = new Set<string>();

export const useApp = create<App>((set, get) => {
  const attach = (sessionId: string, projectId: string) => {
    const c = get().chats[sessionId];
    sock?.send({ type: 'attach', sessionId, projectId, afterSeq: c?.hydrated ? c.lastSeq : undefined });
  };
  const nameOf = (sessionId: string) => {
    for (const rs of Object.values(get().rows)) { const r = rs.find((x) => x.sessionId === sessionId); if (r) return r.name; }
    return 'Sessão';
  };
  const handle = (m: ServerMsg) => {
    if (m.type === 'snapshot') set((s) => ({ chats: { ...s.chats, [m.sessionId]: applySnapshot(m) } }));
    else if (m.type === 'event') {
      const ev = m.event;
      set((s) => (s.chats[ev.sessionId] ? { chats: { ...s.chats, [ev.sessionId]: applyEvent(s.chats[ev.sessionId], ev) } } : s));
      // sessão fora de foco (outra aba interna ou janela em segundo plano) terminou o turno ou pediu permissão
      if ((ev.type === 'turn.completed' || ev.type === 'permission.requested') && (get().active?.sessionId !== ev.sessionId || document.hidden)) {
        set((s) => ({ attention: { ...s.attention, [ev.sessionId]: true } }));
        notify(nameOf(ev.sessionId), ev.type === 'turn.completed' ? 'Resposta concluída' : `Aguardando permissão: ${ev.toolName}`, ev.sessionId);
      }
    } else if (m.type === 'connection.status') {
      set((s) => ({ status: { ...s.status, [m.id]: m.status } }));
    } else if (m.type === 'error') {
      const a = get().active;
      if (a) set((s) => ({ chats: { ...s.chats, [a.sessionId]: addError(s.chats[a.sessionId] ?? emptyChat(), m.message) } }));
    }
  };

  return {
    tokenMissing: false, up: false, config: null, projects: [], rows: {}, active: null, tabs: [], chats: {}, status: {},
    attention: {}, notifyOn: notifyEnabled(), ui: { palette: false, help: false, newSession: false, newFor: null, term: false, settingsFor: null, appSettings: false, spend: false, profile: false },
    layout: loadLayout(), commands: {}, attachments: {},

    async start() {
      if (started) return;
      started = true;
      if (!initToken()) return set({ tokenMissing: true });
      await get().reloadProjects();
      sock = createSocket({
        onMsg: handle,
        onStatus: (up) => set({ up }),
        onReady: () => attached.forEach((pid, sid) => attach(sid, pid)),
      });
      // ponytail: polling de 10 s para o indicador de sessão viva e novas sessões do terminal; trocar por push se pesar
      setInterval(() => get().projects.forEach((p) => void get().refreshRows(p.id)), 10_000);
      // contador de sessões que pedem atenção no título da aba; limpa a da sessão ativa ao voltar para a janela
      useApp.subscribe((s) => {
        const n = Object.values(s.attention).filter(Boolean).length;
        document.title = `${n ? `(${n}) ` : ''}Code Nest`;
      });
      document.addEventListener('visibilitychange', () => {
        const a = get().active;
        if (!document.hidden && a) set((s) => ({ attention: { ...s.attention, [a.sessionId]: false } }));
      });
    },

    async reloadProjects() {
      const { config, projects, status } = await api.state();
      set({ config, projects, status: { ...get().status, ...status } });
      await Promise.all(projects.map((p) => get().refreshRows(p.id)));
    },

    async refreshRows(projectId) {
      const rows = await api.sessions(projectId).catch(() => null);
      if (rows) set((s) => ({ rows: { ...s.rows, [projectId]: rows } }));
    },

    open(projectId, sessionId) {
      attached.set(sessionId, projectId);
      set((s) => ({
        active: { projectId, sessionId },
        tabs: s.tabs.some((t) => t.sessionId === sessionId) ? s.tabs : [...s.tabs, { projectId, sessionId }],
        attention: { ...s.attention, [sessionId]: false },
        chats: s.chats[sessionId] ? s.chats : { ...s.chats, [sessionId]: emptyChat() },
      }));
      attach(sessionId, projectId);
    },

    // fechar a aba só para de acompanhar a sessão nesta janela; o Claude continua rodando no backend
    closeTab(sessionId) {
      const { tabs, active } = get();
      const i = tabs.findIndex((t) => t.sessionId === sessionId);
      if (i < 0) return;
      const rest = tabs.filter((t) => t.sessionId !== sessionId);
      attached.delete(sessionId);
      sock?.send({ type: 'detach', sessionId });
      set({ tabs: rest });
      if (active?.sessionId === sessionId) {
        const next = rest[Math.min(i, rest.length - 1)];
        if (next) get().open(next.projectId, next.sessionId); else set({ active: null });
      }
    },

    cycleTab(dir) {
      const { tabs, active } = get();
      if (tabs.length < 2) return;
      const i = tabs.findIndex((t) => t.sessionId === active?.sessionId);
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      get().open(next.projectId, next.sessionId);
    },

    async patchSession(sessionId, projectId, patch) {
      await api.patchSession(sessionId, projectId, patch);
      await get().refreshRows(projectId);
    },

    setUi(p) { set((s) => ({ ui: { ...s.ui, ...p } })); },

    toggleSidebar() {
      const layout = { ...get().layout, sidebar: !get().layout.sidebar };
      saveLayout(layout);
      set({ layout });
    },
    setSidebarW(w) {
      const layout = { ...get().layout, sidebarW: clampW(w) };
      saveLayout(layout);
      set({ layout });
    },
    toggleCollapsed(key) {
      const { layout } = get();
      const next = { ...layout, collapsed: { ...layout.collapsed, [key]: !layout.collapsed[key] } };
      saveLayout(next);
      set({ layout: next });
    },

    // lista de comandos `/` do projeto (sem custo de tokens); só guarda resultado não vazio, para tentar de novo se falhou
    async ensureCommands(projectId) {
      const p = get().projects.find((x) => x.id === projectId);
      if (!p) return;
      const key = `${p.id}:${p.lean}`;
      if (get().commands[key] || loadingCommands.has(key)) return;
      loadingCommands.add(key);
      try {
        const list = await api.commands(p.id);
        if (list.length) set((s) => ({ commands: { ...s.commands, [key]: list } }));
      } catch { /* tenta de novo na próxima abertura */ } finally { loadingCommands.delete(key); }
    },

    async refreshSession() {
      const a = get().active;
      const p = get().projects.find((x) => x.id === a?.projectId);
      if (!a || !p) return '';
      const r = await api.reload(p.id, a.sessionId);
      const key = `${p.id}:${p.lean}`;
      set((s) => { const { [key]: _, ...rest } = s.commands; return { commands: rest }; });
      await get().ensureCommands(p.id);
      const n = get().commands[key]?.length ?? 0;
      return r.live
        ? `${n} commands/skills · ${r.plugins} plugins${r.errors ? ` · ${r.errors} plugin errors` : ''}`
        : `${n} commands/skills (session not running: the next message loads them fresh)`;
    },

    async toggleNotify() {
      if (get().notifyOn) { disableNotify(); set({ notifyOn: false }); return; }
      set({ notifyOn: await enableNotify() });
    },

    send(text, withFiles = true) {
      const a = get().active;
      if (!a) return;
      const files = withFiles ? get().attachments[a.sessionId] ?? [] : [];
      sock?.send({ type: 'send', sessionId: a.sessionId, text, attachments: files.length ? files : undefined });
      if (files.length) set((s) => ({ attachments: { ...s.attachments, [a.sessionId]: [] } }));
    },
    addAttachment(sessionId, p) {
      set((s) => {
        const cur = s.attachments[sessionId] ?? [];
        if (cur.length >= 10 || cur.includes(p)) return s;
        return { attachments: { ...s.attachments, [sessionId]: [...cur, p] } };
      });
    },
    removeAttachment(sessionId, p) {
      set((s) => ({ attachments: { ...s.attachments, [sessionId]: (s.attachments[sessionId] ?? []).filter((x) => x !== p) } }));
    },
    interrupt() {
      const a = get().active;
      if (a) sock?.send({ type: 'interrupt', sessionId: a.sessionId });
    },
    shell(command) {
      const a = get().active;
      if (a) sock?.send({ type: 'shell', sessionId: a.sessionId, command });
    },
    mcp(id, action) {
      const a = get().active;
      if (a) sock?.send({ type: 'mcp', sessionId: a.sessionId, id, action });
    },
    answer(reqId, allow, updatedInput) {
      const a = get().active;
      if (a) sock?.send({ type: 'permission', sessionId: a.sessionId, reqId, allow, updatedInput });
    },

    async chooseConnection(connectionId) {
      await api.setConnection(connectionId);
      await get().reloadProjects();
    },
  };
});
