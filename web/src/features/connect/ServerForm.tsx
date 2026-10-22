import { useState } from 'react';
import { api } from '../../api';
import { field, primary, secondary } from '../../lib/Modal';

export function ServerForm({ onDone }: { onDone: (connectionId: string) => void }) {
  const [target, setTarget] = useState('');
  const [claudePath, setClaudePath] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = field;
  const body = () => ({ target: target.trim(), ...(claudePath.trim() ? { claudePath: claudePath.trim() } : {}) });

  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.testConnection(body());
      if (!r.ok) setMsg({ kind: 'err', text: r.error ?? 'failed' });
      else setMsg(r.warning ? { kind: 'warn', text: `claude ${r.version}: ${r.warning}` } : { kind: 'ok', text: `Connected. claude ${r.version}` });
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
    setBusy(false);
  };
  const connect = async () => {
    setBusy(true); setMsg(null);
    try { onDone((await api.addConnection(body())).connection.id); } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <input className={input} placeholder="user@192.168.1.12" value={target} onChange={(e) => setTarget(e.target.value)} />
      {advanced
        ? <input className={input} placeholder="Path to claude on the server (default: $HOME/.local/bin/claude)" value={claudePath} onChange={(e) => setClaudePath(e.target.value)} />
        : <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setAdvanced(true)}>advanced…</button>}
      {msg && <div className={`text-sm ${msg.kind === 'ok' ? 'text-emerald-400' : msg.kind === 'warn' ? 'text-amber-400' : 'text-rose-400'}`}>{msg.text}</div>}
      <div className="flex gap-2">
        <button className={secondary} disabled={busy || !target.trim()} onClick={test}>Test</button>
        <button className={primary} disabled={busy || !target.trim()} onClick={connect}>Connect</button>
      </div>
    </div>
  );
}
