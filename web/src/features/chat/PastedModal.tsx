import { useEffect, useState } from 'react';
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
      if (e.key === 'Escape') onClose();
      else if (onSave && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(draft); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, onSave, draft]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-8" onClick={() => { if (!dirty) onClose(); }}>
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-zinc-800/70 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Pasted text #{id}</h2>
          <span className="font-mono text-[11px] text-zinc-500">{lineCount(draft).toLocaleString()} lines · {draft.length.toLocaleString()} chars{!onSave && ' · somente leitura'}</span>
          <span className="flex-1" />
          <button className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
            onClick={() => { void navigator.clipboard.writeText(draft).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copiado' : 'Copiar'}</button>
          {onSave
            ? <button className="rounded-md bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200" title="Salvar (Ctrl+Enter)" onClick={save}>Salvar</button>
            : null}
          <button className="rounded-md px-2 py-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200" title="Fechar (Esc)" onClick={onClose}>✕</button>
        </div>
        <textarea readOnly={!onSave} autoFocus value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)}
          className="min-h-0 flex-1 resize-none bg-zinc-950 p-5 font-mono text-[13px] leading-6 text-zinc-200 outline-none [scrollbar-gutter:stable]" />
      </div>
    </div>
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
