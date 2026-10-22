import { useState } from 'react';
import type { PendingPermission } from '@ccui/shared';
import { Modal, field, ghost, primary } from '../../lib/Modal';

interface AUQOption { label: string; description: string; preview?: string }
interface AUQQuestion { question: string; header: string; options: AUQOption[]; multiSelect: boolean }
interface AUQInput { questions: AUQQuestion[] }

// AskUserQuestion (tool nativa do Claude Code) não tem canal próprio pra resposta: a resposta volta pelo
// mesmo canUseTool de permissão, embutida em `updatedInput` (ver sdk-runtime.ts). Este modal monta esse payload.
export function isAskUserQuestion(p: PendingPermission): boolean {
  return p.toolName === 'AskUserQuestion' && !!p.input && typeof p.input === 'object' && Array.isArray((p.input as { questions?: unknown }).questions);
}

export function AskUserQuestionModal({ p, onAnswer }: { p: PendingPermission; onAnswer: (allow: boolean, updatedInput?: Record<string, unknown>) => void }) {
  const input = p.input as AUQInput;
  const [selected, setSelected] = useState<string[][]>(() => input.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => input.questions.map(() => ''));

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelected((s) => {
      const next = s.slice();
      const cur = next[qi];
      next[qi] = multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : (cur[0] === label ? [] : [label]);
      return next;
    });
    setCustom((c) => { const n = c.slice(); n[qi] = ''; return n; }); // escolher opção limpa o texto customizado
  };

  const setCustomAt = (qi: number, v: string) => {
    setCustom((c) => { const n = c.slice(); n[qi] = v; return n; });
    if (v) setSelected((s) => { const n = s.slice(); n[qi] = []; return n; });
  };

  const answered = (qi: number) => selected[qi].length > 0 || custom[qi].trim() !== '';
  const canSubmit = input.questions.every((_, qi) => answered(qi));

  const submit = () => {
    const answers: Record<string, string> = {};
    input.questions.forEach((q, qi) => { answers[q.question] = custom[qi].trim() || selected[qi].join(', '); });
    onAnswer(true, { ...(p.input as Record<string, unknown>), answers });
  };

  return (
    <Modal
      size="md" title="Claude tem uma pergunta" subtitle="Responda para ele continuar."
      footer={<>
        <button className={ghost} onClick={() => onAnswer(false)}>Cancelar</button>
        <button className={primary} disabled={!canSubmit} onClick={submit}>Responder</button>
      </>}
    >
      <div className="space-y-7">
        {input.questions.map((q, qi) => (
          <div key={qi}>
            <div className="mb-1.5 inline-block rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-400">{q.header}</div>
            <div className="mb-3 text-sm font-medium text-zinc-100">{q.question}</div>
            <div className="space-y-2">
              {q.options.map((o) => {
                const on = selected[qi].includes(o.label);
                return (
                  <button
                    key={o.label}
                    onClick={() => toggle(qi, o.label, q.multiSelect)}
                    className={`block w-full rounded-xl border px-4 py-3 text-left transition-colors duration-150 ${on ? 'border-zinc-100 bg-zinc-800/80' : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900'}`}
                  >
                    <div className="text-sm font-medium text-zinc-100">{o.label}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{o.description}</div>
                    {on && o.preview && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-400">{o.preview}</pre>}
                  </button>
                );
              })}
            </div>
            <input
              className={`${field} mt-2`}
              placeholder="Ou escreva sua própria resposta…"
              value={custom[qi]}
              onChange={(e) => setCustomAt(qi, e.target.value)}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
