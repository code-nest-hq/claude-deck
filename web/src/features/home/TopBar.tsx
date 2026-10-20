import type { ReactNode } from 'react';
import { IconArrowLeft } from '../../lib/icons';
import { useApp } from '../../store';
import { ActivityPills } from './Activity';

// Shared header of every level: Back + breadcrumb on the left, page actions and the global activity pills on the right
export function TopBar({ back, crumb, children }: { back?: string; crumb?: ReactNode; children?: ReactNode }) {
  const goBack = useApp((s) => s.back);
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800/70 px-5 py-3">
      {back ? (
        <button className="-ml-1.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100" title="Back (Alt+←)" onClick={goBack}>
          <IconArrowLeft className="h-4 w-4" /> {back}
        </button>
      ) : (
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="h-5 w-5 rounded-[5px]" />
          <span className="text-sm font-medium tracking-tight text-zinc-100">Code Nest</span>
        </div>
      )}
      {crumb && <span className="min-w-0 truncate text-sm text-zinc-600">/ <span className="text-zinc-100">{crumb}</span></span>}
      <span className="flex-1" />
      <ActivityPills />
      {children}
    </header>
  );
}

export const barBtn = 'rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100';
export const barBtnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200';
