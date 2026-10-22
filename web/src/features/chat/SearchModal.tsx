import { useEffect, useRef, useState } from 'react';
import { findLines } from '@ccui/shared';
import { useApp } from '../../store';
import type { Item } from './reduce';

const PAGE = 5;
const MAX_HITS = 500;

export interface SearchRow { key: string; label: string; session?: string; pre: string; match: string; post: string; go: () => void }

// underline `term` (nth occurrence) inside message i of the open chat for 3 s or until the next click (CSS Custom Highlight API: no DOM changes)
export function jumpTo(i: number, term: string, nth: number): boolean {
  const el = document.querySelector<HTMLElement>(`[data-i="${i}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const full = nodes.map((n) => n.data).join('').toLowerCase();
  const needle = term.toLowerCase();
  let at = -1;
  for (let k = 0; k <= nth; k++) at = full.indexOf(needle, at + 1);
  if (at < 0) at = full.indexOf(needle);
  if (at < 0) return true;
  const range = document.createRange();
  let off = 0;
  let started = false;
  for (const n of nodes) {
    if (!started && at < off + n.length) { range.setStart(n, at - off); started = true; }
    if (started && at + term.length <= off + n.length) { range.setEnd(n, at + term.length - off); break; }
    off += n.length;
  }
  CSS.highlights.set('search-hit', new Highlight(range));
  const clear = () => { CSS.highlights.delete('search-hit'); clearTimeout(timer); document.removeEventListener('click', clear, true); };
  const timer = setTimeout(clear, 3000);
  setTimeout(() => document.addEventListener('click', clear, true), 0); // not the click that picked the hit
  return true;
}

// open a session (maybe not loaded yet) and jump to the message holding `line`; waits for the history to hydrate and render
export function jumpToLine(projectId: string, sessionId: string, line: string, term: string, nth: number) {
  useApp.getState().open(projectId, sessionId);
  let tries = 0;
  const t = setInterval(() => {
    const items = useApp.getState().chats[sessionId]?.items ?? [];
    const i = items.findIndex((it) => (it.kind === 'user' || it.kind === 'assistant' || it.kind === 'error') && it.text.includes(line));
    if ((i >= 0 && jumpTo(i, term, nth)) || ++tries > 50) clearInterval(t);
  }, 100);
}

// hits in the messages of the open session; picking one jumps to it
export function sessionSearch(items: Item[], onPick: (item: number, term: string, nth: number) => void) {
  return async (q: string): Promise<SearchRow[]> => {
    const rows: SearchRow[] = [];
    for (let i = 0; i < items.length && rows.length < MAX_HITS; i++) {
      const it = items[i];
      if (it.kind !== 'user' && it.kind !== 'assistant' && it.kind !== 'error') continue;
      for (const h of findLines(it.text, q)) {
        rows.push({ key: `${i}:${rows.length}`, label: LABEL[it.kind], pre: h.pre, match: h.match, post: h.post, go: () => onPick(i, q, h.nth) });
      }
    }
    return rows;
  };
}

const LABEL = { user: 'você', assistant: 'claude', error: 'erro' } as const;

// search box with a paged result list; `search` runs (debounced) on every change of the text
export function SearchModal({ placeholder, search, onClose }: { placeholder: string; search: (q: string) => Promise<SearchRow[]>; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  useEffect(() => {
    const term = q.trim();
    setShown(PAGE);
    setErr('');
    if (!term) { setRows([]); setBusy(false); return; }
    setBusy(true);
    let stale = false;
    const t = setTimeout(() => {
      search(term).then((r) => { if (!stale) { setRows(r); setBusy(false); } }, (e: Error) => { if (!stale) { setErr(e.message); setBusy(false); } });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps -- `search` is rebuilt every render; only the text should retrigger

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] text-left font-sans backdrop-blur-sm" onClick={onClose}>
      <div className="layer max-h-[76vh] w-full max-w-2xl overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]" style={{ '--layer-from': '0px' } as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <input
            ref={input}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-zinc-600"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-200" onClick={onClose}>Fechar</button>
        </div>
        {q.trim() && (
          <div className="mt-3 text-xs text-zinc-500">
            {err ? <span className="text-rose-300">{err}</span> : busy ? 'Pesquisando…' : rows.length === 0 ? 'Nenhum resultado' : `${rows.length >= MAX_HITS ? `${MAX_HITS}+` : rows.length} ${rows.length === 1 ? 'resultado' : 'resultados'}`}
          </div>
        )}
        <ul className="mt-3 space-y-2">
          {rows.slice(0, shown).map((h) => (
            <li key={h.key}>
              <button className="block w-full rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-4 py-3 text-left hover:border-zinc-700 hover:bg-zinc-900" onClick={() => { onClose(); h.go(); }}>
                <div className="flex gap-2 font-mono text-[11px] uppercase tracking-wider text-zinc-600">
                  <span>{h.label}</span>
                  {h.session && <span className="min-w-0 truncate normal-case tracking-normal text-zinc-500">{h.session}</span>}
                </div>
                <div className="mt-1 break-words text-sm text-zinc-300">
                  {h.pre}<span className="underline decoration-[#c9a00c] decoration-2 underline-offset-2">{h.match}</span>{h.post}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {rows.length > shown && (
          <button className="mt-2 w-full rounded-md border border-zinc-800 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900" onClick={() => setShown((n) => n + PAGE)}>
            Mostrar mais ({rows.length - shown})
          </button>
        )}
      </div>
    </div>
  );
}
