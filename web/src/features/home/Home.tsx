import { useState } from 'react';
import type { Project } from '@ccui/shared';
import { api } from '../../api';
import { IconPlus, IconServer, IconSettings } from '../../lib/icons';
import { projectColor } from '../../lib/projectColor';
import { useApp } from '../../store';
import { ServerForm } from '../connect/ServerForm';
import { useActivity } from './activity';
import { NewProjectModal } from './NewProjectModal';
import { barBtn, TopBar } from './TopBar';

const tile = 'project-card card-in flex min-h-[116px] flex-col rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-left outline-none';
const statusDot = { up: 'bg-emerald-400', reconnecting: 'bg-amber-400 animate-pulse', down: 'bg-rose-400' } as const;

function ProjectCard({ p, i }: { p: Project; i: number }) {
  const go = useApp((s) => s.go);
  const rows = useApp((s) => s.rows[p.id]);
  const entries = useActivity().filter((e) => e.projectId === p.id);
  const needs = entries.filter((e) => e.kind === 'needs').length;
  const running = entries.length - needs;
  const open = (rows ?? []).filter((r) => !r.archived).length;
  const status = needs ? { dot: 'bg-amber-400', text: `${needs} needs you` } : running ? { dot: 'bg-blue-500 animate-pulse', text: `${running} running` } : null;
  return (
    <button className={tile} style={{ '--c': projectColor(p), '--i': i } as React.CSSProperties} onClick={() => go({ name: 'project', projectId: p.id })}>
      <span className="truncate text-sm font-semibold text-zinc-100">{p.name}</span>
      <span className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{p.path}</span>
      <span className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-zinc-500">
        {status && <><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.text} · </>}
        {open} {open === 1 ? 'session' : 'sessions'}
      </span>
    </button>
  );
}

function NewProjectTile({ onClick }: { onClick: () => void }) {
  return (
    <button className={`${tile} items-center justify-center gap-2 border-dashed text-zinc-500 hover:text-zinc-100`} style={{ '--c': 'var(--color-zinc-300)', '--i': 0 } as React.CSSProperties} onClick={onClick}>
      <IconPlus className="h-5 w-5" />
      <span className="text-sm">New project</span>
    </button>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">{children}</div>;
}

export function Home() {
  const { projects, config, status, go, setUi } = useApp();
  const [creating, setCreating] = useState(false);
  const local = projects.filter((p) => p.connectionId === 'local');
  const ssh = config?.connections.filter((c) => c.kind === 'ssh') ?? [];
  const online = ssh.filter((c) => status[c.id] === 'up').length;
  return (
    <div className="flex h-screen flex-col">
      <TopBar>
        <button className={barBtn} title="Shortcuts (?)" onClick={() => setUi({ help: true })}>?</button>
        <button className={barBtn} onClick={() => setUi({ profile: true, logs: false })}>Profile</button>
        <button className={barBtn} onClick={() => setUi({ logs: true, profile: false, logFilter: '' })}>Logs</button>
        <button className={`${barBtn} flex items-center gap-1.5`} onClick={() => setUi({ appSettings: true })}><IconSettings className="h-3.5 w-3.5" /> Settings</button>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Projects</h1>
        <p className="mb-6 mt-1 max-w-[65ch] text-sm text-zinc-500">Pick a project to open its sessions and tools. Everything for a project lives inside it.</p>
        <Grid>
          <NewProjectTile onClick={() => setCreating(true)} />
          {local.map((p, i) => <ProjectCard key={p.id} p={p} i={i + 1} />)}
          <button className={tile} style={{ '--c': '#7928ca', '--i': local.length + 1 } as React.CSSProperties} onClick={() => go({ name: 'remote' })}>
            <span className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><IconServer className="h-4 w-4 text-zinc-400" /> Remote</span>
            <span className="mt-0.5 text-[11px] text-zinc-600">Projects on SSH servers</span>
            <span className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-zinc-500">
              {ssh.length === 0 ? 'No servers yet' : `${ssh.length} ${ssh.length === 1 ? 'server' : 'servers'} · ${online} online`}
            </span>
          </button>
        </Grid>
        {local.length === 0 && <p className="mt-8 text-sm text-zinc-600">No local projects yet. Create one to start your first session.</p>}
      </div>
      {creating && <NewProjectModal connectionId="local" onClose={() => setCreating(false)} />}
    </div>
  );
}

export function RemotePicker() {
  const { config, projects, status, go, reloadProjects } = useApp();
  const [adding, setAdding] = useState(false);
  const ssh = config?.connections.filter((c) => c.kind === 'ssh') ?? [];
  return (
    <div className="flex h-screen flex-col">
      <TopBar back="Projects" crumb="Remote">
        <button className={barBtn} onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : '+ Add server'}</button>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Choose a server</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-500">Each server has its own projects.</p>
        {adding && (
          <div className="mb-6 max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="mb-3 text-xs text-zinc-500">Uses your existing SSH configuration.</p>
            <ServerForm onDone={async (id) => { setAdding(false); await reloadProjects(); go({ name: 'server', connectionId: id }); }} />
          </div>
        )}
        {ssh.length === 0 && !adding && <p className="text-sm text-zinc-600">No servers yet. Add one to run Claude on a remote machine.</p>}
        <Grid>
          {ssh.map((c, i) => {
            const st = status[c.id] ?? 'reconnecting';
            const n = projects.filter((p) => p.connectionId === c.id).length;
            return (
              <button key={c.id} className={tile} style={{ '--c': '#7928ca', '--i': i } as React.CSSProperties} onClick={() => go({ name: 'server', connectionId: c.id })}>
                <span className="truncate text-sm font-semibold text-zinc-100">{c.label}</span>
                <span className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{c.target}</span>
                <span className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-zinc-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot[st]}`} />{st === 'up' ? 'online' : st === 'down' ? 'offline' : 'reconnecting…'} · {n} {n === 1 ? 'project' : 'projects'}
                </span>
              </button>
            );
          })}
        </Grid>
      </div>
    </div>
  );
}

export function ServerCatalog({ connectionId }: { connectionId: string }) {
  const { config, projects, status, go, reloadProjects } = useApp();
  const [creating, setCreating] = useState(false);
  const conn = config?.connections.find((c) => c.id === connectionId);
  const list = projects.filter((p) => p.connectionId === connectionId);
  const st = status[connectionId] ?? 'reconnecting';
  return (
    <div className="flex h-screen flex-col">
      <TopBar back="Servers" crumb={conn?.label ?? 'Server'}>
        <button
          className={`${barBtn} hover:text-rose-400`}
          title="Remove server (nothing is deleted on the server)"
          onClick={async () => { if (conn && confirm(`Remove server "${conn.label}" and its projects from the list?`)) { await api.delConnection(conn.id); await reloadProjects(); go({ name: 'remote' }); } }}
        >Remove server</button>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-zinc-100">
          {conn?.label ?? 'Server'} <span className={`h-2 w-2 rounded-full ${statusDot[st]}`} title={st} />
        </h1>
        <p className="mb-6 mt-1 font-mono text-xs text-zinc-600">{conn?.target}</p>
        <Grid>
          <NewProjectTile onClick={() => setCreating(true)} />
          {list.map((p, i) => <ProjectCard key={p.id} p={p} i={i + 1} />)}
        </Grid>
      </div>
      {creating && <NewProjectModal connectionId={connectionId} onClose={() => setCreating(false)} />}
    </div>
  );
}
