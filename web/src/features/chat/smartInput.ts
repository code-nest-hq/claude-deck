// Markdown-as-you-type for the prompt textarea (what the model reads is markdown anyway): lists continue on Enter,
// "```" opens a self-closing code block, and pasted code is fenced with a guessed language. Pure functions: the
// caller applies the returned text/caret.
export interface Edit { text: string; caret: number }

const BULLET = '•';
const ITEM_RE = /^(\s*)([-*+•]|\d+\.) (.*)$/;
const FENCE_RE = /^\s*```/;

const lineStartOf = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;

/** caret sits inside an unclosed ``` block (an Enter there is a plain newline, never "send") */
export function insideFence(text: string, pos: number): boolean {
  let open = false;
  for (const line of text.slice(0, lineStartOf(text, pos)).split('\n')) if (FENCE_RE.test(line)) open = !open;
  return open;
}

/** Enter: continue a list item, end the list on an empty one, or expand "```lang" into a closed block; null = not special */
export function onEnter(text: string, pos: number): Edit | null {
  const start = lineStartOf(text, pos);
  const line = text.slice(start, pos);
  if (insideFence(text, pos)) return null;
  if (/^```[\w+-]*$/.test(line)) { // "```ts" + Enter -> block with the caret inside
    const at = text.slice(0, pos) + '\n\n```' + text.slice(pos);
    return { text: at, caret: pos + 1 };
  }
  const m = ITEM_RE.exec(line);
  if (!m) return null;
  const [, indent, marker, body] = m;
  if (!body.trim()) return { text: text.slice(0, start) + text.slice(pos), caret: start }; // empty item: leave the list
  const next = /^\d+/.test(marker) ? `${parseInt(marker, 10) + 1}.` : marker;
  const ins = `\n${indent}${next} `;
  return { text: text.slice(0, pos) + ins + text.slice(pos), caret: pos + ins.length };
}

const KEYWORD = /^\s*(?:import|export|const|let|var|function|class|interface|type|def|return|if|else|for|while|try|catch|public|private|package|using|namespace|from|async|await|#include|SELECT|INSERT|UPDATE|DELETE|CREATE)\b/;
const SYMBOL = /(?:=>|->|::|==|!=|&&|\|\||[;{}]\s*$|\)\s*:?\s*$|^\s*[})\]]+[,;]?\s*$)/;
const looksLikeCode = (line: string) => KEYWORD.test(line) || SYMBOL.test(line) || /^(?: {2,}|\t)\S/.test(line);

function guessLang(code: string): string {
  const t = code.trim();
  if (/^[[{]/.test(t)) { try { JSON.parse(t); return 'json'; } catch { /* not json */ } }
  if (/^<[a-z!][\s\S]*>$/i.test(t)) return 'html';
  if (/^#!.*\b(?:ba)?sh\b|^\$ /m.test(t)) return 'bash';
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE)\b/i.test(t) && /;\s*$/.test(t)) return 'sql';
  if (/^\s*def \w+\(.*\):|^\s*(?:from \S+ )?import \S+\s*$/m.test(t) && !/;\s*$/m.test(t)) return 'python';
  if (/\b(?:interface|type) \w+|: (?:string|number|boolean)\b/.test(t)) return 'ts';
  if (/=>|\b(?:const|let|function)\b|\bimport .* from\b/.test(t)) return 'js';
  return '';
}

/** multi-line paste that reads as code (and isn't already fenced) -> the same text wrapped in a fenced block, else null */
export function fenceIfCode(pasted: string): string | null {
  const lines = pasted.replace(/\s+$/, '').split('\n');
  if (lines.length < 2 || lines.some((l) => FENCE_RE.test(l))) return null;
  const nonEmpty = lines.filter((l) => l.trim() && !ITEM_RE.test(l));
  const codey = nonEmpty.filter(looksLikeCode).length;
  if (codey < 2 || codey / Math.max(1, lines.filter((l) => l.trim()).length) < 0.5) return null;
  const body = lines.join('\n');
  return '```' + guessLang(body) + '\n' + body + '\n```';
}

/** pastes `block` at [a,b): keeps a fenced block on its own lines */
export function insertBlock(text: string, a: number, b: number, block: string): Edit {
  const pre = a > 0 && text[a - 1] !== '\n' ? '\n' : '';
  const post = b < text.length && text[b] !== '\n' ? '\n' : '';
  const ins = pre + block + post;
  return { text: text.slice(0, a) + ins + text.slice(b), caret: a + pre.length + block.length };
}

/** "* " / "- " typed at the start of a line becomes a visible bullet; `pos` is the caret right after the space */
export function bulletize(text: string, pos: number): Edit | null {
  const start = lineStartOf(text, pos);
  const m = /^(\s*)[-*] $/.exec(text.slice(start, pos));
  if (!m || insideFence(text, pos)) return null;
  const ins = m[1] + BULLET + ' ';
  return { text: text.slice(0, start) + ins + text.slice(pos), caret: start + ins.length };
}

/** what is sent to the model: visible bullets back to markdown "- " (code blocks untouched) */
export function toMarkdown(text: string): string {
  let open = false;
  return text.split('\n').map((l) => {
    if (FENCE_RE.test(l)) open = !open;
    return open ? l : l.replace(/^(\s*)• /, '$1- ');
  }).join('\n');
}
