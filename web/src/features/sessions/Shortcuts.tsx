import { useApp } from '../../store';
import { Modal } from '../../lib/Modal';

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
  return (
    <Modal size="md" onClose={close} title="Shortcuts">
      <dl className="divide-y divide-zinc-800/70 text-sm">
        {KEYS.map(([k, d]) => (
          <div key={k} className="flex items-baseline gap-4 py-2.5"><dt className="w-44 shrink-0"><kbd className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300">{k}</kbd></dt><dd className="text-zinc-400">{d}</dd></div>
        ))}
      </dl>
    </Modal>
  );
}
