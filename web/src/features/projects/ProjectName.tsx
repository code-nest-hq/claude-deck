import { useState } from 'react';
import type { Project } from '@ccui/shared';
import { api } from '../../api';
import { IconPencil } from '../../lib/icons';
import { useApp } from '../../store';

// Project name with an inline rename: the pencil swaps the name for an input; Enter saves, Esc or blur cancels.
export function ProjectName({ p, className = '', reveal = false }: { p: Project; className?: string; reveal?: boolean }) {
  const reloadProjects = useApp((s) => s.reloadProjects);
  const [draft, setDraft] = useState<string | null>(null);
  const save = async () => {
    const name = draft?.trim();
    setDraft(null);
    if (name && name !== p.name) { await api.patchProject(p.id, { name }); await reloadProjects(); }
  };
  if (draft !== null) return (
    <input
      autoFocus maxLength={80} value={draft} aria-label="Project name"
      className={`${className} min-w-0 flex-1 rounded-md border border-zinc-600 bg-zinc-900 px-1.5 outline-none`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void save();
        else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
  return (
    <>
      <span className={`${className} truncate`}>{p.name}</span>
      <button
        title="Edit" aria-label="Edit project name"
        className={`shrink-0 rounded-md p-1 text-zinc-500 transition-all hover:bg-zinc-800 hover:text-zinc-100 ${reveal ? 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100' : ''}`}
        onClick={(e) => { e.stopPropagation(); setDraft(p.name); }}
      ><IconPencil className="h-3.5 w-3.5" /></button>
    </>
  );
}
