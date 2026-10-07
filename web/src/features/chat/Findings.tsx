import { useState } from 'react';

export interface Finding {
  file?: string;
  line?: number;
  summary: string;
  detail?: string;
  category?: string;
  verdict?: string;
  outcome?: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// Code-review style skills end their output with a JSON array of findings; anything else stays a normal code block.
export function parseFindings(raw: string): Finding[] | null {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(data)) return null;
  const out: Finding[] = [];
  for (const x of data) {
    if (!x || typeof x !== 'object') return null;
    const o = x as Record<string, unknown>;
    const summary = str(o.summary) ?? str(o.short_summary) ?? str(o.title) ?? str(o.message) ?? str(o.description);
    if (!summary) return null;
    out.push({
      file: str(o.file) ?? str(o.path),
      line: typeof o.line === 'number' ? o.line : undefined,
      summary,
      detail: str(o.failure_scenario) ?? str(o.scenario) ?? str(o.details),
      category: str(o.category),
      verdict: str(o.verdict),
      outcome: str(o.outcome),
    });
  }
  return out;
}

const chip = 'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide';
const VERDICT: Record<string, string> = {
  CONFIRMED: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
  PLAUSIBLE: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
};

function FindingRow({ f, index }: { f: Finding; index: number }) {
  const [open, setOpen] = useState(false);
  const base = f.file?.split('/').pop();
  return (
    <li className="group rounded-md border border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700">
      <button
        type="button"
        disabled={!f.detail}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={f.detail ? open : undefined}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-semibold text-zinc-300">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug text-zinc-100">{f.summary}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {f.file && (
              <code title={f.file} className="max-w-full truncate rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">
                {base}{f.line != null ? `:${f.line}` : ''}
              </code>
            )}
            {f.category && <span className={`${chip} bg-zinc-800 text-zinc-400`}>{f.category}</span>}
            {f.verdict && <span className={`${chip} ${VERDICT[f.verdict] ?? 'bg-zinc-800 text-zinc-400'}`}>{f.verdict}</span>}
            {f.outcome && <span className={`${chip} bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30`}>{f.outcome}</span>}
          </span>
        </span>
        {f.detail && <span aria-hidden className={`mt-1 text-xs text-zinc-500 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>}
      </button>
      {f.detail && open && (
        <div className="border-t border-zinc-800 px-3 py-2.5 pl-11 text-[13px] leading-relaxed text-zinc-400">
          {f.file && f.file !== base && <div className="mb-1.5 font-mono text-[11px] text-zinc-500">{f.file}</div>}
          {f.detail}
        </div>
      )}
    </li>
  );
}

export function Findings({ items }: { items: Finding[] }) {
  if (!items.length) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
        <span aria-hidden>✓</span> Nenhum problema encontrado
      </div>
    );
  }
  return (
    <section className="my-3" aria-label="Findings">
      <header className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
        Findings
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">{items.length}</span>
      </header>
      <ul className="space-y-2">
        {items.map((f, i) => <FindingRow key={i} f={f} index={i} />)}
      </ul>
    </section>
  );
}
