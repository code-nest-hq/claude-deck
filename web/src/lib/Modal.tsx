import { useEffect } from 'react';
import { IconX } from './icons';

// Shared modal shell: blurred scrim, rounded panel, fixed header/footer with a scrolling body, Esc to close.
const WIDTH = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;

export const field = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-zinc-600';
export const label = 'mb-1.5 block text-xs font-medium text-zinc-400';
export const primary = 'rounded-md bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-40';
export const secondary = 'rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-40';
export const ghost = 'rounded-md px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40';
export const card = 'rounded-xl border border-zinc-800/80 bg-zinc-900/40 transition-colors';

export function Modal({ onClose, title, subtitle, size = 'md', actions, footer, children }: {
  onClose?: () => void; // omitted: a pending decision, so no X, no Esc, no scrim click
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  size?: keyof typeof WIDTH;
  actions?: React.ReactNode; // header controls, left of the close button
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-left font-sans backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        role="dialog" aria-modal="true"
        className={`layer flex max-h-[min(88vh,52rem)] w-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] ${WIDTH[size]}`}
        style={{ '--layer-from': '0px' } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
          </div>
          {actions}
          {onClose && <button className="-mr-2 -mt-1 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100" aria-label="Close" onClick={onClose}><IconX className="h-4 w-4" /></button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-zinc-800/80 px-6 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

// Segmented tab control used in modal headers.
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: Array<{ id: T; label: string; count?: number }>; onChange: (t: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={`rounded-md px-3 py-1 text-sm transition-colors ${o.id === value ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-200'}`} onClick={() => onChange(o.id)}>
          {o.label}{o.count != null && <span className="ml-1.5 text-xs text-zinc-500">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
