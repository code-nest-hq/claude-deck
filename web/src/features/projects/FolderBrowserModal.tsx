import { useEffect, useState } from 'react';
import type { DirEntry } from '@ccui/shared';
import { api } from '../../api';
import { Modal, field, ghost, primary, secondary } from '../../lib/Modal';

// Navega o filesystem da conexão (local ou SSH) pra escolher uma pasta sem digitar o caminho.
// path === null enquanto não carregou a 1ª vez (home da conexão); depois disso é sempre o caminho absoluto atual.
export function FolderBrowserModal({ connectionId, mode = 'dir', onPick, onClose }: { connectionId: string; mode?: 'dir' | 'file'; onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [jump, setJump] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = (p: string | null) => {
    setLoading(true);
    api.browse(connectionId, p, mode === 'file' ? 'all' : 'dir')
      .then((r) => { setPath(r.path); setEntries(r.entries); setErr(''); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(null); }, [connectionId]);

  const visible = entries.filter((e) => showHidden || !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
  const up = () => { if (path && path !== '/') load(path.slice(0, path.lastIndexOf('/')) || '/'); };
  const crumbs = (path ?? '/').split('/').filter(Boolean);

  return (
    <Modal
      size="md" onClose={onClose} title={mode === 'file' ? 'Escolher arquivo' : 'Escolher pasta'}
      subtitle={
        <span className="flex items-center gap-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-400">
          <button className="hover:text-zinc-200" onClick={() => load('/')}>/</button>
          {crumbs.map((seg, i) => {
            const target = '/' + crumbs.slice(0, i + 1).join('/');
            return (
              <span key={target} className="flex items-center gap-1">
                <span className="text-zinc-700">/</span>
                <button className="hover:text-zinc-200" onClick={() => load(target)}>{seg}</button>
              </span>
            );
          })}
        </span>
      }
      footer={<>
        <button className={ghost} onClick={onClose}>Cancelar</button>
        {mode === 'dir' && <button className={primary} disabled={!path} onClick={() => path && onPick(path)}>Selecionar esta pasta</button>}
      </>}
    >
      <div className="mb-3 flex gap-2">
        <input
          className={`${field} min-w-0 flex-1 font-mono text-xs`}
          placeholder="ir para um caminho…"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && jump.trim()) load(jump.trim()); }}
        />
        <button className={secondary} onClick={() => jump.trim() && load(jump.trim())}>Ir</button>
      </div>
      <div className="h-72 overflow-y-auto rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-1.5">
        {loading && <div className="p-3 text-sm text-zinc-600">Carregando…</div>}
        {err && <div className="p-3 text-sm text-rose-400">{err}</div>}
        {!loading && !err && (
          <ul className="space-y-0.5">
            {path !== '/' && (
              <li><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-800/60" onClick={up}>..</button></li>
            )}
            {visible.length === 0 && <li className="px-3 py-2 text-sm text-zinc-600">Pasta vazia</li>}
            {visible.map((e) => {
              const full = `${path === '/' ? '' : path}/${e.name}`;
              return (
                <li key={e.name}>
                  <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800/60" onClick={() => (e.isDir ? load(full) : onPick(full))}>
                    <span className="text-zinc-500">{e.isDir ? '▸' : '▪'}</span>{e.name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
        <input type="checkbox" className="h-4 w-4 accent-zinc-100" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> mostrar ocultos
      </label>
    </Modal>
  );
}
