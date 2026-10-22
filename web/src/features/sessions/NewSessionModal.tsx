import { useState } from 'react';
import { EFFORTS, MODELS, type Effort, type Model } from '@ccui/shared';
import { api } from '../../api';
import { useApp } from '../../store';
import { Modal, field, ghost, label, primary } from '../../lib/Modal';

export function NewSessionModal({ onClose }: { onClose: () => void }) {
  const { projects, config, active, ui, open, refreshRows } = useApp();
  const [pid, setPid] = useState(ui.newFor ?? active?.projectId ?? projects[0]?.id ?? '');
  const [name, setName] = useState('New session');
  const [model, setModel] = useState<Model>(config!.defaults.model);
  const [effort, setEffort] = useState<Effort>(config!.defaults.effort);
  const [err, setErr] = useState('');

  const create = async () => {
    try {
      const s = await api.newSession(pid, { name, model, effort });
      await refreshRows(pid);
      open(pid, s.sessionId);
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Modal
      size="sm" onClose={onClose} title="New session" subtitle="Start a fresh Claude Code session in a project."
      footer={<><button className={ghost} onClick={onClose}>Cancel</button><button className={primary} disabled={!pid} onClick={create}>Create session</button></>}
    >
      <div className="space-y-4">
        <div>
          <label className={label} htmlFor="ns-project">Project</label>
          <select id="ns-project" className={field} value={pid} onChange={(e) => setPid(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ns-name">Name</label>
          <input id="ns-name" autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && pid) void create(); }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="ns-model">Model</label>
            <select id="ns-model" className={field} value={model} onChange={(e) => setModel(e.target.value as Model)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div>
            <label className={label} htmlFor="ns-effort">Effort</label>
            <select id="ns-effort" className={field} value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>{EFFORTS.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
        </div>
        {err && <div className="text-sm text-rose-400">{err}</div>}
      </div>
    </Modal>
  );
}
