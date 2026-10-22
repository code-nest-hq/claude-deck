import { useState } from 'react';
import { AttachmentsModal } from './AttachmentsModal';

// Composer "+": a one-item menu ("Attach") that opens the attachments modal.
export function AttachMenu({ sessionId, connectionId }: { sessionId: string; connectionId: string }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);

  return (
    <div className="relative">
      <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" title="Attach" onClick={() => setOpen((o) => !o)}>+</button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-48 rounded-md border border-zinc-800 bg-zinc-900 p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <button className="block w-full rounded-sm px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800" onClick={() => { setOpen(false); setModal(true); }}>Attach</button>
        </div>
      )}
      {modal && <AttachmentsModal sessionId={sessionId} connectionId={connectionId} onClose={() => setModal(false)} />}
    </div>
  );
}
