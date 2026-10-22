import { useState, useSyncExternalStore } from 'react';
import { EFFORTS, MODELS, type Effort, type Model } from '@ccui/shared';
import { api } from '../api';
import { useApp } from '../store';
import { cycleTheme, getTheme, subscribeTheme, themeLabel } from '../theme';
import { ServerForm } from '../features/connect/ServerForm';
import { Modal, card, field, ghost, primary, secondary } from '../lib/Modal';
import { DEFAULT_PASTE_LINES, pasteThreshold, setPasteThreshold } from '../features/chat/pasted';

const section = 'mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500';

// Configuração da aplicação: padrões globais (model/effort) e servidores remotos — o que não é
// por-projeto, mora aqui. Substitui o antigo botão "+ Nova sessão" no rodapé da sidebar (nova sessão já é
// alcançável via Ctrl+K e pelo "+" de cada projeto).
export function AppSettingsModal({ onClose }: { onClose: () => void }) {
  const { config, reloadProjects, notifyOn, toggleNotify } = useApp();
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const d = config?.defaults;
  const [addingServer, setAddingServer] = useState(false);
  const [err, setErr] = useState('');
  const [pasteLines, setPasteLines] = useState(pasteThreshold);

  const patch = async (b: Partial<{ model: Model; effort: Effort }>) => {
    try { await api.patchConfig(b); await reloadProjects(); setErr(''); } catch (e) { setErr((e as Error).message); }
  };

  if (!d || !config) return null;
  const ssh = config.connections.filter((c) => c.kind === 'ssh');
  return (
    <Modal size="md" onClose={onClose} title="Settings" subtitle="App-wide preferences. Per-project options live in project settings." footer={<button className={primary} onClick={onClose}>Done</button>}>
      <div className="space-y-7">
        <section>
          <div className={section}>Appearance &amp; alerts</div>
          <div className="flex flex-wrap gap-2">
            <button className={secondary} onClick={cycleTheme}>{themeLabel[theme]}</button>
            <button className={secondary} title="Alerts when a background session finishes or asks for permission" onClick={() => void toggleNotify()}>Notifications: {notifyOn ? 'on' : 'off'}</button>
          </div>
        </section>

        <section>
          <div className={section}>Defaults</div>
          <p className="mb-3 text-sm text-zinc-500">Used by any session or project that doesn't set its own value.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-zinc-400">Model
              <select className={`${field} mt-1.5 font-normal`} value={d.model} onChange={(e) => void patch({ model: e.target.value as Model })}>
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-400">Effort
              <select className={`${field} mt-1.5 font-normal`} value={d.effort} onChange={(e) => void patch({ effort: e.target.value as Effort })}>
                {EFFORTS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
          {err && <div className="mt-2 text-sm text-rose-400">{err}</div>}
        </section>

        <section>
          <div className={section}>Pasted text</div>
          <label className="block text-sm text-zinc-400">Pastes with at least N lines become an attachment (default {DEFAULT_PASTE_LINES})
            <input type="number" min={2} className={`${field} mt-2 !w-28`} value={pasteLines}
              onChange={(e) => { const n = Math.max(2, Math.floor(Number(e.target.value)) || DEFAULT_PASTE_LINES); setPasteLines(n); setPasteThreshold(n); }} />
          </label>
        </section>

        <section>
          <div className={section}>Remote servers</div>
          {ssh.length === 0 && <div className="mb-3 text-sm text-zinc-600">No remote servers yet.</div>}
          <ul className="mb-3 space-y-2">
            {ssh.map((c) => (
              <li key={c.id} className={`${card} flex items-center justify-between px-4 py-2.5`}>
                <span className="truncate font-mono text-xs text-zinc-300">{c.label}</span>
                <button className="rounded-md p-1 text-zinc-600 transition-colors hover:text-rose-400" title="Remove server (nothing is deleted on the server)"
                  onClick={async () => { if (confirm(`Remove server "${c.label}" and its projects from the list?`)) { await api.delConnection(c.id); await reloadProjects(); } }}
                >✕</button>
              </li>
            ))}
          </ul>
          {addingServer ? (
            <div className={`${card} p-4`}>
              <ServerForm onDone={async () => { setAddingServer(false); await reloadProjects(); }} />
              <button className={`${ghost} mt-3 -ml-3`} onClick={() => setAddingServer(false)}>Cancel</button>
            </div>
          ) : (
            <button className={secondary} onClick={() => setAddingServer(true)}>+ Remote server</button>
          )}
        </section>
      </div>
    </Modal>
  );
}
