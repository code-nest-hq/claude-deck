// Large pastes become an inline "[Pasted text #1 +612 lines]" token in the input; the real text lives in Chat state
// and is expanded back on submit. Threshold is a global (browser-wide) setting, not per project/session.
const KEY = 'ccui.pasteLines';
export const DEFAULT_PASTE_LINES = 600;

export const pasteThreshold = (): number => {
  try { const n = Number(localStorage.getItem(KEY)); return Number.isInteger(n) && n >= 2 ? n : DEFAULT_PASTE_LINES; } catch { return DEFAULT_PASTE_LINES; }
};
export const setPasteThreshold = (n: number) => { try { localStorage.setItem(KEY, String(n)); } catch { /* ignore */ } };

export const pasteToken = (id: number, lines: number) => `[Pasted text #${id} +${lines} lines]`;
export const TOKEN_RE = /\[Pasted text #(\d+) \+\d+ lines\]/g;

export const TOKEN_SPLIT_RE = /(\[Pasted text #\d+ \+\d+ lines\])/; // capture group: odd split parts are tokens

export const lineCount = (s: string) => s.split('\n').length;

// wrap=true marks each block as <pasted-text id="N"> so the conversation can show it as a chip again (also after a reload);
// the model just sees a tagged block. wrap=false (shell "!cmd") inlines the raw text.
export const expandPastes = (text: string, pastes: Record<number, string>, wrap = true) =>
  text.replace(TOKEN_RE, (m, id) => { const p = pastes[Number(id)]; return p === undefined ? m : wrap ? `<pasted-text id="${id}">\n${p}\n</pasted-text>` : p; });

const BLOCK_RE = /<pasted-text id="(\d+)">\n([\s\S]*?)\n<\/pasted-text>/g;
export const hasPasted = (text: string) => text.includes('<pasted-text id="');
// splits a sent message into plain strings and pasted blocks
export const splitPasted = (text: string): (string | { id: number; text: string })[] => {
  const out: (string | { id: number; text: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(BLOCK_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ id: Number(m[1]), text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

// id of the token under the caret (strictly inside it), if any
export const tokenAt = (text: string, pos: number): number | undefined => {
  for (const m of text.matchAll(TOKEN_RE)) if (pos > m.index && pos < m.index + m[0].length) return Number(m[1]);
  return undefined;
};
