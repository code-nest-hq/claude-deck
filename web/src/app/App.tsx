import { useEffect } from 'react';
import { Chat } from '../features/chat/Chat';
import { PinnedBar } from '../features/home/PinnedBar';
import { ActivityOverlay, Toasts } from '../features/home/Activity';
import { Home, RemotePicker, ServerCatalog } from '../features/home/Home';
import { LogsPage } from '../features/logs/LogsPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { ProjectHub, ProjectModals } from '../features/projects/ProjectHub';
import { NewSessionModal } from '../features/sessions/NewSessionModal';
import { Palette } from '../features/sessions/Palette';
import { SessionsPage } from '../features/sessions/SessionsPage';
import { Shortcuts } from '../features/sessions/Shortcuts';
import { useApp, type View } from '../store';
import { AppSettingsModal } from './AppSettingsModal';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function Screen({ view }: { view: View }) {
  switch (view.name) {
    case 'home': return <Home />;
    case 'remote': return <RemotePicker />;
    case 'server': return <ServerCatalog connectionId={view.connectionId} />;
    case 'project': return <ProjectHub projectId={view.projectId} />;
    case 'sessions': return <SessionsPage projectId={view.projectId} />;
    case 'chat': return <div className="flex h-full flex-col"><Chat /></div>;
  }
}

export function App() {
  const { tokenMissing, config, ui, view, navDir, start, setUi, back, chooseConnection } = useApp();
  useEffect(() => { void start(); }, [start]);
  // the old "where do you want to run Claude?" gate is gone: local is always available, remote lives under the Remote card
  useEffect(() => { if (config && !config.lastConnectionId) void chooseConnection('local'); }, [config, chooseConnection]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setUi({ palette: !s.ui.palette }); }
      else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); if (s.projects.length) setUi({ newSession: true, newFor: s.view.name === 'chat' || s.view.name === 'project' || s.view.name === 'sessions' ? s.view.projectId : null }); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'j') { e.preventDefault(); setUi({ term: !s.ui.term }); }
      else if (e.key === '?' && !typing(e.target)) { e.preventDefault(); setUi({ help: true }); }
      else if (e.key === 'Escape' && s.ui.newSession) setUi({ newSession: false, newFor: null });
      else if (e.key === 'Escape' && s.ui.activity) setUi({ activity: false });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setUi, back]);

  if (tokenMissing) return <div className="p-8 text-zinc-300">Open the UI from the link printed in the terminal (<code>Code Nest: http://…/#token=…</code>).</div>;
  if (!config) return <div className="p-8 text-zinc-500">Loading…</div>;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950">
      <PinnedBar />
      {/* keyed by level: each one mounts as a fresh layer and slides in over the previous one */}
      <div key={ui.profile ? 'profile' : ui.logs ? 'logs' : JSON.stringify(view)} className="layer min-h-0 flex-1" style={{ '--layer-from': `${16 * navDir}px` } as React.CSSProperties}>
        {ui.profile ? <div className="flex h-full flex-col"><ProfilePage onClose={() => setUi({ profile: false })} /></div>
          : ui.logs ? <div className="flex h-full flex-col"><LogsPage onClose={() => setUi({ logs: false })} /></div>
          : <Screen view={view} />}
      </div>
      <Toasts />
      <ActivityOverlay />
      <ProjectModals />
      {ui.newSession && <NewSessionModal onClose={() => setUi({ newSession: false, newFor: null })} />}
      {ui.appSettings && <AppSettingsModal onClose={() => setUi({ appSettings: false })} />}
      {ui.palette && <Palette />}
      {ui.help && <Shortcuts />}
    </div>
  );
}
