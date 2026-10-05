import { useEffect } from 'react';
import { ConnectScreen } from '../features/connect/ConnectScreen';
import { Chat } from '../features/chat/Chat';
import { Sidebar } from '../features/projects/Sidebar';
import { NewSessionModal } from '../features/sessions/NewSessionModal';
import { Palette } from '../features/sessions/Palette';
import { Shortcuts } from '../features/sessions/Shortcuts';
import { Tabs } from '../features/sessions/Tabs';
import { LogsPage } from '../features/logs/LogsPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { useApp } from '../store';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function App() {
  const { tokenMissing, config, ui, layout, start, setUi, cycleTab, toggleSidebar } = useApp();
  useEffect(() => { void start(); }, [start]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setUi({ palette: !s.ui.palette }); }
      else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); if (s.projects.length) setUi({ newSession: true, newFor: null }); }
      else if (e.altKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleSidebar(); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); cycleTab(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'j') { e.preventDefault(); setUi({ term: !s.ui.term }); }
      else if (e.key === '?' && !typing(e.target)) { e.preventDefault(); setUi({ help: true }); }
      else if (e.key === 'Escape' && s.ui.newSession) setUi({ newSession: false, newFor: null });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setUi, cycleTab, toggleSidebar]);

  if (tokenMissing) return <div className="p-8 text-zinc-300">Abra a UI pelo link impresso no terminal (<code>Code Nest: http://…/#token=…</code>).</div>;
  if (!config) return <div className="p-8 text-zinc-500">Carregando…</div>;
  if (!config.lastConnectionId) return <ConnectScreen />;
  return (
    <div className="flex h-screen">
      {layout.sidebar
        ? <Sidebar />
        : (
          <button className="flex w-8 shrink-0 items-start justify-center border-r border-zinc-800 pt-3 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" title="Mostrar barra lateral (Alt+L)" onClick={toggleSidebar}>»</button>
        )}
      <div className="flex min-w-0 flex-1 flex-col">
        {ui.profile ? <ProfilePage onClose={() => setUi({ profile: false })} />
          : ui.logs ? <LogsPage onClose={() => setUi({ logs: false })} />
          : (<><Tabs /><Chat /></>)}
      </div>
      {ui.newSession && <NewSessionModal onClose={() => setUi({ newSession: false, newFor: null })} />}
      {ui.palette && <Palette />}
      {ui.help && <Shortcuts />}
    </div>
  );
}
