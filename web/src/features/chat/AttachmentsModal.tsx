import { useState } from 'react';
import { useApp } from '../../store';
import { Modal, card, ghost, primary, secondary } from '../../lib/Modal';
import { IconFile, IconPaperclip, IconPlus, IconX } from '../../lib/icons';
import { FolderBrowserModal } from '../projects/FolderBrowserModal';

export const NO_ATTACHMENTS: string[] = []; // stable ref: a fresh [] per call makes zustand's selector never settle (React #185)

const split = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return { name: p.slice(i + 1), dir: i > 0 ? p.slice(0, i) : '' };
};

// Pending files for the next message: review, remove, add more.
export function AttachmentsModal({ sessionId, connectionId, onClose }: { sessionId: string; connectionId: string; onClose: () => void }) {
  const files = useApp((s) => s.attachments[sessionId] ?? NO_ATTACHMENTS);
  const addAttachment = useApp((s) => s.addAttachment);
  const removeAttachment = useApp((s) => s.removeAttachment);
  const [picking, setPicking] = useState(false);

  const add = (
    <button className={`${secondary} inline-flex items-center gap-1.5`} onClick={() => setPicking(true)}><IconPlus className="h-3.5 w-3.5" />Add file</button>
  );

  return (
    <>
      <Modal
        onClose={onClose}
        title="Attachments"
        subtitle={files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} will be sent with your next message` : 'Files are sent with your next message'}
        footer={<>
          {files.length > 1 && <button className={`${ghost} mr-auto hover:!text-rose-400`} onClick={() => files.forEach((f) => removeAttachment(sessionId, f))}>Remove all</button>}
          {files.length > 0 && add}
          <button className={primary} onClick={onClose}>Done</button>
        </>}
      >
        {files.length === 0 ? (
          <button className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 px-6 py-10 text-center transition-colors hover:border-zinc-600 hover:bg-zinc-900/40" onClick={() => setPicking(true)}>
            <span className="rounded-full bg-zinc-900 p-3 text-zinc-400"><IconPaperclip className="h-5 w-5" /></span>
            <span className="text-sm font-medium text-zinc-200">Add a file</span>
            <span className="text-xs text-zinc-500">Browse the project machine and attach files to this session</span>
          </button>
        ) : (
          <ul className="space-y-2">
            {files.map((f) => {
              const { name, dir } = split(f);
              return (
                <li key={f} className={`${card} group flex items-center gap-3 px-3 py-2.5 hover:border-zinc-700`}>
                  <span className="shrink-0 rounded-lg bg-zinc-800/70 p-2 text-zinc-400"><IconFile className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-100" title={name}>{name}</div>
                    {dir && <div className="truncate font-mono text-xs text-zinc-500" title={f}>{dir}</div>}
                  </div>
                  <button className="shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400" aria-label={`Remove ${name}`} title="Remove" onClick={() => removeAttachment(sessionId, f)}><IconX className="h-4 w-4" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
      {picking && (
        <FolderBrowserModal
          connectionId={connectionId}
          mode="file"
          onPick={(p) => { addAttachment(sessionId, p); setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
