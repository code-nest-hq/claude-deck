import { useEffect, useState } from 'react';
import { Modal, primary, secondary } from '../../lib/Modal';
import { lineCount, pasteToken } from './pasted';

// Large viewer for a pasted block: wide, tall, monospace, soft line height. With onSave it is editable
// (text area before sending); without it, read-only (message already sent).
export function PastedModal({ id, text, onClose, onSave }: { id: number; text: string; onClose: () => void; onSave?: (text: string) => void }) {
  const [draft, setDraft] = useState(text);
  const [copied, setCopied] = useState(false);
  const dirty = draft !== text;
  const save = () => { onSave?.(draft); onClose(); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (onSave && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(draft); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, onSave, draft]);
  return (
    <Modal
      size="xl" onClose={dirty ? undefined : onClose} title={`Pasted text #${id}`}
      subtitle={<span className="font-mono text-xs">{lineCount(draft).toLocaleString()} lines · {draft.length.toLocaleString()} chars{!onSave && ' · somente leitura'}</span>}
      actions={<div className="flex items-center gap-2">
        <button className={secondary}
          onClick={() => { void navigator.clipboard.writeText(draft).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copiado' : 'Copiar'}</button>
        {onSave && <button className={primary} title="Salvar (Ctrl+Enter)" onClick={save}>Salvar</button>}
        {dirty && <button className={secondary} onClick={onClose}>Descartar</button>}
      </div>}
    >
      <textarea readOnly={!onSave} autoFocus value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)}
        className="h-[60vh] w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 p-5 font-mono text-[13px] leading-6 text-zinc-200 outline-none focus:border-zinc-700 [scrollbar-gutter:stable]" />
    </Modal>
  );
}

// chip for a pasted block inside a sent message: click opens the read-only viewer
export function PastedChip({ id, text }: { id: number; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="mx-0.5 rounded-sm bg-sky-500/25 px-1 align-baseline text-sky-200 transition-colors hover:bg-sky-500/40" onClick={() => setOpen(true)}>{pasteToken(id, lineCount(text))}</button>
      {open && <PastedModal id={id} text={text} onClose={() => setOpen(false)} />}
    </>
  );
}
