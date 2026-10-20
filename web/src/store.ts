import { create } from 'zustand';
import type { Config, ConnStatus, LogEntry, McpAction, Project, ServerMsg, SessionRow, SlashCommandInfo } from '@ccui/shared';
import { api, initToken } from './api';
import { addError, applyEvent, applySnapshot, emptyChat, type Chat } from './features/chat/reduce';
import { disableNotify, enableNotify, notify, notifyEnabled } from './notify';
import { createSocket } from './ws';

export type View =
  | { name: 'home' }
  | { name: 'remote' }
  | { name: 'server'; connectionId: string }
  | { name: 'project'; projectId: string }
  | { name: 'sessions'; projectId: string }
  | { name: 'chat'; projectId: string; sessionId: string };
export interface Ui { palette: boolean; help: boolean; newSession: boolean; newFor: string | null; term: boolean; settingsFor: string | null; searchFor: string | null; appSettings: boolean; profile: boolean; logs: boolean; logFilter: string; activity: boolean }
/** a finished turn, shown briefly in the toast stack; sessions that need the user are derived from `chats[*].pending` instead */
export interface DoneToast { id: string; projectId: string; sessionId: string }

type SessionPatch = { name?: string; favorite?: boolean; archived?: boolean; tags?: string[] };

interface App {
  tokenMissing: boolean;
  up: boolean;
  config: Config | null;
  projects: Project[];
  rows: Record<string, SessionRow[]>;
  active: { projectId: string; sessionId: string } | null;
  /** sessionId -> projectId for every session this page has opened (they stay attached when you leave the chat) */
  attachedTo: Record<string, string>;
  view: View;
  /** 1 = went deeper, -1 = went back; drives the layer transition */
  navDir: 1 | -1;
  toasts: DoneToast[];
  chats: Record<string, Chat>;
  status: Record<string, ConnStatus>;
  attention: Record<string, boolean>; // sessões que terminaram/pediram permissão fora de foco
  notifyOn: boolean;
  ui: Ui;
  commands: Record<string, SlashCommandInfo[]>; // chave "<projeto>:<lean>"
  attachments: Record<string, string[]>; // sessionId -> caminhos absolutos ainda não enviados
  logs: LogEntry[]; // error log entries pushed live since this page loaded (the Logs page merges them with the day's file)
  start(): Promise<void>;
  reloadProjects(): Promise<void>;
  refreshRows(projectId: string): Promise<void>;
  open(projectId: string, sessionId: string): void;
  go(view: View): void;
  back(): void;
  dismissToast(id: string): void;
  patchSession(sessionId: string, projectId: string, patch: SessionPatch): Promise<void>;
  setUi(p: Partial<Ui>): void;
  ensureCommands(projectId: string): Promise<void>;
  /** reloads skills/plugins into the active session and refetches the `/` list; resolves to a short status line */
  refreshSession(): Promise<string>;
  addAttachment(sessionId: string, path: string): void;
  removeAttachment(sessionId: string, path: string): void;
  toggleNotify(): Promise<void>;
  /** withFiles=false leaves the pending attachments for the next message (e.g. an automatic `/compact`) */
  send(text: string, withFiles?: boolean, origin?: 'auto-compact'): void;
  /** the user dismissed the auto-compact prompt (recorded in the session log) */
  compactDeclined(percentage: number): void;
  interrupt(): void;
  shell(command: string): void;
  mcp(id?: string, action?: McpAction): void;
  answer(reqId: string, allow: boolean, updatedInput?: Record<string, unknown>): void;
  chooseConnection(connectionId: string): Promise<void>;
}

const parentOf = (v: View, projects: Project[]): View => {
  if (v.name === 'chat') return { name: 'sessions', projectId: v.projectId };
  if (v.name === 'sessions') return { name: 'project', projectId: v.projectId };
  if (v.name === 'project') {
    const c = projects.find((p) => p.id === v.projectId)?.connectionId;
    return c && c !== 'local' ? { name: 'server', connectionId: c } : { name: 'home' };
  }
  if (v.name === 'server') return { name: 'remote' };
  return { name: 'home' };
};

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
    return 'Session';
  };
  const handle = (m: ServerMsg) => {
    if (m.type === 'snapshot') set((s) => ({ chats: { ...s.chats, [m.sessionId]: applySnapshot(m) } }));
    else if (m.type === 'event') {
      const ev = m.event;
      set((s) => (s.chats[ev.sessionId] ? { chats: { ...s.chats, [ev.sessionId]: applyEvent(s.chats[ev.sessionId], ev) } } : s));
      // session not on screen (another page, or the window is in the background) finished its turn or asked for permission
      const v = get().view;
      const onScreen = v.name === 'chat' && v.sessionId === ev.sessionId && !get().ui.profile && !get().ui.logs;
      if ((ev.type === 'turn.completed' || ev.type === 'permission.requested') && (!onScreen || document.hidden)) {
        set((s) => ({ attention: { ...s.attention, [ev.sessionId]: true } }));
        notify(nameOf(ev.sessionId), ev.type === 'turn.completed' ? 'Response finished' : `Waiting for permission: ${ev.toolName}`, ev.sessionId);
        if (ev.type === 'turn.completed' && !document.hidden) {
          const pid = attached.get(ev.sessionId);
          const id = `${ev.sessionId}:${Date.now()}`;
          if (pid) {
            set((s) => ({ toasts: [...s.toasts.filter((t) => t.sessionId !== ev.sessionId), { id, projectId: pid, sessionId: ev.sessionId }] }));
            setTimeout(() => get().dismissToast(id), 6000);
          }
        }
      }
    } else if (m.type === 'connection.status') {
      set((s) => ({ status: { ...s.status, [m.id]: m.status } }));
    } else if (m.type === 'error') {
      const a = get().active;
      if (a) set((s) => ({ chats: { ...s.chats, [a.sessionId]: addError(s.chats[a.sessionId] ?? emptyChat(), m.message, m.errorId) } }));
    } else if (m.type === 'log') {
      set((s) => ({ logs: [...s.logs.slice(-1999), m.entry] }));
    }
  };

  return {
    tokenMissing: false, up: false, config: null, projects: [], rows: {}, active: null, attachedTo: {}, view: { name: 'home' }, navDir: 1, toasts: [], chats: {}, status: {},
    attention: {}, notifyOn: notifyEnabled(), ui: { palette: false, help: false, newSession: false, newFor: null, term: false, settingsFor: null, searchFor: null, appSettings: false, profile: false, logs: false, logFilter: '', activity: false },
    logs: [],
    commands: {}, attachments: {},

    async start() {
      if (started) return;
      started = true;
      if (!initToken()) return set({ tokenMissing: true });
      await get().reloadProjects();
      const saved = history.state?.view as View | undefined;
      if (saved) {
        set({ view: saved });
        if (saved.name === 'chat') get().open(saved.projectId, saved.sessionId);
      } else history.replaceState({ view: get().view, depth: 0 }, '');
      window.addEventListener('popstate', (e) => {
        const v = (e.state?.view as View | undefined) ?? { name: 'home' };
        set((s) => ({ view: v, navDir: -1, ui: { ...s.ui, activity: false, profile: false, logs: false } }));
        if (v.name === 'chat') get().open(v.projectId, v.sessionId);
      });
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
        attachedTo: { ...s.attachedTo, [sessionId]: projectId },
        attention: { ...s.attention, [sessionId]: false },
        toasts: s.toasts.filter((t) => t.sessionId !== sessionId),
        chats: s.chats[sessionId] ? s.chats : { ...s.chats, [sessionId]: emptyChat() },
      }));
      attach(sessionId, projectId);
      get().go({ name: 'chat', projectId, sessionId });
    },

    // every level is a full-screen layer; the browser history mirrors the stack so Back / Alt+Left / the mouse button all work
    go(view) {
      const cur = get().view;
      if (JSON.stringify(cur) === JSON.stringify(view)) return;
      history.pushState({ view, depth: (history.state?.depth ?? 0) + 1 }, '');
      set({ view, navDir: 1, ui: { ...get().ui, activity: false, profile: false, logs: false } });
    },

    back() {
      const { ui, view, projects } = get();
      if (ui.profile || ui.logs) { set({ ui: { ...ui, profile: false, logs: false } }); return; }
      if ((history.state?.depth ?? 0) > 0) { history.back(); return; }
      const parent = parentOf(view, projects);
      set({ view: parent, navDir: -1 });
      history.replaceState({ view: parent, depth: 0 }, '');
    },

    dismissToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },

    async patchSession(sessionId, projectId, patch) {
      await api.patchSession(sessionId, projectId, patch);
      await get().refreshRows(projectId);
    },

    setUi(p) { set((s) => ({ ui: { ...s.ui, ...p } })); },

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

    send(text, withFiles = true, origin) {
      const a = get().active;
      if (!a) return;
      const files = withFiles ? get().attachments[a.sessionId] ?? [] : [];
      sock?.send({ type: 'send', sessionId: a.sessionId, text, attachments: files.length ? files : undefined, origin });
      if (files.length) set((s) => ({ attachments: { ...s.attachments, [a.sessionId]: [] } }));
    },
    compactDeclined(percentage) {
      const a = get().active;
      if (a) sock?.send({ type: 'compact.declined', sessionId: a.sessionId, percentage });
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
      // the session that owns the prompt, not the active one: switching sessions between render and click must not misroute it
      const sessionId = Object.keys(get().chats).find((id) => get().chats[id].pending.some((p) => p.reqId === reqId));
      if (sessionId) sock?.send({ type: 'permission', sessionId, reqId, allow, updatedInput });
    },

    async chooseConnection(connectionId) {
      await api.setConnection(connectionId);
      await get().reloadProjects();
    },
  };
});
