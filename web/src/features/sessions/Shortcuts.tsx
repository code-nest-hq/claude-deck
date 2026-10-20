import { useEffect } from 'react';
import { useApp } from '../../store';

const KEYS: [string, string][] = [
  ['Ctrl/Cmd + K', 'Palette: search sessions and actions'],
  ['Alt + N', 'New session'],
  ['Alt + ←', 'Back to the previous level'],
  ['Ctrl + J', 'Commands panel (terminal, read-only)'],
  ['/', 'At the start of a message: commands and skills (↑↓, Tab/Enter, Esc)'],
  ['! command', 'Shell mode: runs the command in the project directory (local or server), no tokens spent'],
  ['Enter / Shift + Enter', 'Send / new line'],
  ['Esc', 'Close windows'],
  ['?', 'This help'],
];

export function Shortcuts() {
  const setUi = useApp((s) => s.setUi);
  const close = () => setUi({ help: false });
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div className="w-96 space-y-2 rounded-lg border border-zinc-700 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Shortcuts</h2>
        <dl className="space-y-1 text-sm">
          {KEYS.map(([k, d]) => (
            <div key={k} className="flex gap-3"><dt className="w-40 shrink-0 font-mono text-xs text-zinc-300">{k}</dt><dd className="text-zinc-400">{d}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}
