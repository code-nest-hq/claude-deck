import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Project, SessionRow } from '@ccui/shared';
import { api } from '../../api';
import { matchRow } from '../../lib/search';
import { SIDEBAR_W_MAX, SIDEBAR_W_MIN, useApp } from '../../store';
import { cycleTheme, getTheme, subscribeTheme, themeLabel } from '../../theme';
import { AppSettingsModal } from '../../app/AppSettingsModal';
import { IconSettings } from '../../lib/icons';
import { FolderBrowserModal } from './FolderBrowserModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';

const ago = (t: number) => {
  const s = (t - Date.now()) / 1000, a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  return a < 3600 ? f.format(Math.round(s / 60), 'minute') : a < 86400 ? f.format(Math.round(s / 3600), 'hour') : f.format(Math.round(s / 86400), 'day');
};
const dot = { up: 'bg-green-500', reconnecting: 'bg-amber-500', down: 'bg-red-500' } as const;

const Chevron = ({ open }: { open: boolean }) => <span className="w-3 shrink-0 text-[10px] text-zinc-500 transition-transform duration-150">{open ? '▾' : '▸'}</span>;

// resumo do que acontece dentro de um item recolhido: azul = rodando/aguardando permissão; verde = terminou fora de foco
function Pulse({ busy, attn }: { busy: boolean; attn: boolean }) {
  if (busy) return <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-500" title="Há sessão em andamento" />;
  if (attn) return <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" title="Há sessão que terminou ou precisa de atenção" />;
  return null;
}

// pontinhos discretos mostrando quais flags do projeto-pai estão ativas nesta sessão (não competem com o nome)
function ProjectFlags({ p }: { p: Project }) {
  const flags: Array<[boolean | undefined, string, string]> = [[p.lean, 'bg-zinc-500', 'lean'], [p.routing, 'bg-zinc-400', 'model routing'], [p.bypass, 'bg-rose-400/80', 'bypass de permissões']];
  const on = flags.filter(([v]) => v);
  if (on.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={`Projeto: ${on.map(([, , l]) => l).join(', ')} ativo(s)`}>
      {on.map(([, cls, l]) => <span key={l} className={`h-1 w-1 rounded-full ${cls}`} />)}
    </span>
  );
}

function SessionItem({ r, projectId, project, projectName, onTag }: { r: SessionRow; projectId: string; project: Project; projectName?: string; onTag: (t: string) => void }) {
  const { active, open, patchSession } = useApp();
  const state = useApp((s) => s.chats[r.sessionId]?.state);
  const attention = useApp((s) => !!s.attention[r.sessionId]);
  const color = state === 'awaiting_permission' ? 'bg-amber-500 animate-pulse' : state === 'running' ? 'bg-blue-500 animate-pulse' : attention || r.live ? 'bg-green-500' : 'bg-zinc-600';
  const act = 'rounded px-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100';

  const selected = active?.sessionId === r.sessionId;
  return (
    <li className="group relative pl-3">
      {/* conector horizontal: liga a linha vertical do <ul> pai até o item */}
      <span className="pointer-events-none absolute left-0 top-1/2 h-px w-2.5 -translate-y-1/2 bg-zinc-800" aria-hidden />
      <button
        onClick={() => open(projectId, r.sessionId)}
        className={`flex w-full items-center gap-2 rounded-sm py-1 pl-2 pr-2 text-left text-[13px] transition-colors duration-150 ${
          selected ? 'bg-zinc-800/60 text-zinc-100 shadow-[inset_2px_0_0_0] shadow-zinc-400' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
        }`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
        <span className={`flex-1 truncate ${attention ? 'font-semibold' : ''} ${r.archived ? 'text-zinc-500' : ''}`}>{r.name}</span>
        <ProjectFlags p={project} />
        {projectName && <span className="shrink-0 text-[10px] text-zinc-600">{projectName}</span>}
        <span className="shrink-0 text-[11px] text-zinc-600 group-hover:invisible">{ago(r.lastModified)}</span>
      </button>
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded bg-zinc-900 text-xs group-hover:flex">
        <button className={act} title="Renomear" onClick={async () => { const n = prompt('Novo nome da sessão', r.name); if (n?.trim()) await patchSession(r.sessionId, projectId, { name: n.trim() }); }}>✎</button>
        <button className={act} title="Tags (separadas por vírgula)" onClick={async () => {
          const v = prompt('Tags separadas por vírgula (letras, números, - e _)', r.tags.join(', '));
          if (v !== null) await patchSession(r.sessionId, projectId, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) }).catch((e) => alert((e as Error).message));
        }}>#</button>
        <button className={act} title={r.favorite ? 'Remover dos favoritos' : 'Favoritar'} onClick={() => patchSession(r.sessionId, projectId, { favorite: !r.favorite })}>{r.favorite ? '★' : '☆'}</button>
        <button className={act} title={r.archived ? 'Desarquivar' : 'Arquivar'} onClick={() => patchSession(r.sessionId, projectId, { archived: !r.archived })}>{r.archived ? '↩' : '▣'}</button>
      </div>
      {r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-1 pl-6">
          {r.tags.map((t) => <button key={t} className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400 hover:text-zinc-100" onClick={() => onTag(t)}>#{t}</button>)}
        </div>
      )}
    </li>
  );
}

export function Sidebar() {
  const { config, projects, rows, status, notifyOn, layout, reloadProjects, setUi, toggleNotify, toggleSidebar, toggleCollapsed, setSidebarW, ui } = useApp();
  const chats = useApp((s) => s.chats);
  const attention = useApp((s) => s.attention);
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const dragging = useRef(false);
  // arrasto na borda direita: mousemove/mouseup globais só enquanto dragging.current, sem re-render por movimento (setSidebarW já persiste)
  useEffect(() => {
    const move = (e: MouseEvent) => { if (dragging.current) setSidebarW(e.clientX); };
    const up = () => { dragging.current = false; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [setSidebarW]);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [form, setForm] = useState({ name: '', path: '', lean: false, connectionId: 'local' });
  const [err, setErr] = useState('');
  const connections = config?.connections ?? [];
  const searching = query.trim() !== '';

  // durante a busca, os resultados aparecem mesmo dentro de itens recolhidos
  const isOpen = (key: string) => searching || !layout.collapsed[key];
  const visible = (pid: string) => (rows[pid] ?? []).filter((r) => (showArchived || !r.archived) && matchRow(r, query));
  const pulse = (pids: string[]) => {
    const all = pids.flatMap((pid) => rows[pid] ?? []);
    return {
      busy: all.some((r) => chats[r.sessionId]?.state === 'running' || chats[r.sessionId]?.state === 'awaiting_permission'),
      attn: all.some((r) => attention[r.sessionId]),
    };
  };
  const favorites = projects.flatMap((p) => visible(p.id).filter((r) => r.favorite && !r.archived).map((r) => ({ r, p })));

  const addProject = async () => {
    try {
      await api.addProject(form);
      setForm({ ...form, name: '', path: '' });
      setAdding(false);
      setErr('');
      await reloadProjects();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <aside className="relative flex h-screen shrink-0 flex-col border-r border-zinc-800/70 bg-zinc-950" style={{ width: layout.sidebarW }}>
      {/* alça de redimensionar: arrasta pra qualquer largura entre SIDEBAR_W_MIN e SIDEBAR_W_MAX (persistido em ccui-layout) */}
      <div
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-zinc-700/60"
        onMouseDown={(e) => { e.preventDefault(); dragging.current = true; document.body.style.cursor = 'col-resize'; }}
        title={`Arraste para redimensionar (${SIDEBAR_W_MIN}–${SIDEBAR_W_MAX}px)`}
      />
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-zinc-800/60 px-3">
        <img src="/logo.png" alt="" className="h-5 w-5 shrink-0 rounded-[5px]" />
        <span className="text-sm font-medium tracking-tight text-zinc-100">Code Nest</span>
      </div>
      <div className="space-y-2.5 border-b border-zinc-800/60 p-3">
        <div className="flex items-center gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-1.5 text-zinc-400 transition-colors focus-within:border-zinc-700">
          <input className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-500" placeholder="Buscar sessões ou #tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="shrink-0 text-zinc-500 hover:text-zinc-200" title="Ocultar barra lateral (Alt+L)" onClick={toggleSidebar}>«</button>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <button className="hover:text-zinc-300" onClick={cycleTheme}>{themeLabel[theme]}</button>
          <button className="hover:text-zinc-300" title="Avisa quando uma sessão em segundo plano termina ou pede permissão" onClick={() => void toggleNotify()}>Notificações: {notifyOn ? 'on' : 'off'}</button>
          <button className="ml-auto rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300" title="Atalhos (?)" onClick={() => setUi({ help: true })}>?</button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-2">
        {favorites.length > 0 && (
          <section className="space-y-1">
            <button className="flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300" onClick={() => toggleCollapsed('f')}>
              <Chevron open={isOpen('f')} /> Favoritas <span className="font-normal text-zinc-600">{favorites.length}</span>
            </button>
            {isOpen('f') && (
              <ul className="space-y-0.5">
                {favorites.map(({ r, p }) => <SessionItem key={r.sessionId} r={r} projectId={p.id} project={p} projectName={p.name} onTag={(t) => setQuery(`#${t}`)} />)}
              </ul>
            )}
          </section>
        )}

        {connections.map((c) => {
          const cps = projects.filter((p) => p.connectionId === c.id);
          const total = cps.reduce((n, p) => n + visible(p.id).length, 0);
          if (searching && total === 0) return null;
          const ck = `c:${c.id}`;
          const open = isOpen(ck);
          const cp = pulse(cps.map((p) => p.id));
          return (
            <section key={c.id} className="space-y-1.5">
              <div className="group/c flex items-center gap-1 px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors duration-150 hover:text-zinc-300" onClick={() => toggleCollapsed(ck)} title={open ? 'Recolher' : 'Expandir'}>
                  <Chevron open={open} />
                  {c.kind === 'ssh' && <span className={`h-2 w-2 shrink-0 rounded-full ${dot[status[c.id] ?? 'reconnecting']}`} title={status[c.id] ?? 'reconnecting'} />}
                  <span className="truncate">{c.kind === 'local' ? 'LOCAL' : c.label.toUpperCase()}</span>
                  <span className="ml-auto font-normal normal-case tracking-normal text-zinc-600">{total}</span>
                  {!open && <Pulse {...cp} />}
                </button>
                {c.kind === 'ssh' && (
                  <button className="hidden text-zinc-600 hover:text-red-400 group-hover/c:block" title="Remover servidor (não apaga nada no servidor)"
                    onClick={async () => { if (confirm(`Remover o servidor "${c.label}" e seus projetos da lista?`)) { await api.delConnection(c.id); await reloadProjects(); } }}>✕</button>
                )}
              </div>

              {open && (
                <div className="ml-1.5 space-y-1.5 border-l border-zinc-800/70 pl-2">
                  {cps.map((p) => {
                    const list = visible(p.id);
                    if (searching && list.length === 0) return null;
                    const pk = `p:${p.id}`;
                    const pOpen = isOpen(pk);
                    const pp = pulse([p.id]);
                    return (
                      <div key={p.id} className="group/p">
                        <div className="flex items-center gap-1">
                          <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold text-zinc-200 transition-colors duration-150 hover:text-zinc-50" onClick={() => toggleCollapsed(pk)} title={`${p.path}\n${pOpen ? 'Recolher' : 'Expandir'}`}>
                            <Chevron open={pOpen} />
                            <span className="truncate">{p.name}</span>
                            <span className="ml-auto text-xs font-normal text-zinc-600">{list.length}</span>
                            {!pOpen && <Pulse {...pp} />}
                          </button>
                          <ProjectFlags p={p} />
                          <button className="hidden rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 group-hover/p:block" title="Configurações do projeto" onClick={() => setUi({ settingsFor: p.id })}>⚙</button>
                          <button className="hidden rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 group-hover/p:block" title="Nova sessão neste projeto" onClick={() => setUi({ newSession: true, newFor: p.id })}>+</button>
                        </div>
                        {pOpen && (
                          <ul className="mt-1 space-y-0.5 border-l border-zinc-800/50 pl-1">
                            {list.length === 0 && <li className="px-2 py-1 text-xs text-zinc-600">Nenhuma sessão</li>}
                            {list.map((r) => <SessionItem key={r.sessionId} r={r} projectId={p.id} project={p} onTag={(t) => setQuery(`#${t}`)} />)}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input type="checkbox" className="h-3.5 w-3.5 rounded-sm border border-zinc-700 bg-zinc-900 accent-zinc-100" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> mostrar arquivadas
        </label>

        {adding ? (
          <div className="space-y-2 rounded border border-zinc-800 p-2 text-sm">
            <select className="w-full rounded bg-zinc-900 px-2 py-1" value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value })}>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input className="w-full rounded bg-zinc-900 px-2 py-1" placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="flex gap-1">
              <input className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1" placeholder="/caminho/absoluto (no servidor escolhido)" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
              <button className="shrink-0 rounded border border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800" onClick={() => setBrowsing(true)}>Procurar</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={form.lean} onChange={(e) => setForm({ ...form, lean: e.target.checked })} /> lean</label>
            {err && <div className="text-xs text-red-400">{err}</div>}
            <div className="flex gap-2">
              <button className="rounded bg-zinc-100 px-2 py-1 text-zinc-900" onClick={addProject}>Adicionar</button>
              <button className="px-2 py-1 text-zinc-400" onClick={() => { setAdding(false); setErr(''); }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="block text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setAdding(true)}>+ Novo projeto</button>
        )}
      </div>
      <div className="m-3 flex gap-1.5">
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900" onClick={() => setUi({ profile: true, logs: false })}>
          Perfil
        </button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900" onClick={() => setUi({ logs: true, profile: false, logFilter: '' })}>
          Logs
        </button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900" onClick={() => setUi({ appSettings: true })}>
          <IconSettings className="h-3.5 w-3.5" /> Configurações
        </button>
      </div>
      {ui.settingsFor && <ProjectSettingsModal projectId={ui.settingsFor} onClose={() => setUi({ settingsFor: null })} />}
      {browsing && (
        <FolderBrowserModal
          connectionId={form.connectionId}
          onPick={(p) => { setForm({ ...form, path: p }); setBrowsing(false); }}
          onClose={() => setBrowsing(false)}
        />
      )}
      {ui.appSettings && <AppSettingsModal onClose={() => setUi({ appSettings: false })} />}
    </aside>
  );
}
