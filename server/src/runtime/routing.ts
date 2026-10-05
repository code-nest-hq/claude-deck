import { readFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Model } from '@ccui/shared';
import { DATA_DIR } from '../store';

// stems match as word prefixes (no trailing \b): "refator" must catch refatorar/refatora, "migrat" migrate/migrating.
// A false hit only costs Sonnet on a simple prompt; a miss costs an extra Haiku classifier call.
const SONNET_HINTS = /\b(implementa|implement|refator|refactor|cri[ae]|creat|constr(?:[oó][ei]|u)|build|arquitet|architect|desenh[ae]|design|corrig[ei].*bug|fix.*bug|migra|migrat|integra|integrat|escreve|write.*(fun[cç][aã]o|function|componente|component|endpoint|feature|teste|test)|planej[ae]|plan)/i;
// a short prompt about a commit message is text generation over a diff already in context, not coding
// (checked before SONNET_HINTS: "cria a mensagem de commit" would otherwise hit "cri[ae]")
const COMMIT_MESSAGE = /\b(commit message|mensage(?:m|ns) de commit)/i;
const HAIKU_HINTS = /^\s*(o que|what is|what's|explica|explain|list[ae]|mostr[ae]|show|confirma|confirm|qual|which|quando|when|resum[ae]|summariz)\b/i;

// null = zona cinzenta: a heurística não decide, precisa da chamada Haiku descartável (ver sdk-runtime.ts classifyViaHaiku)
export function classifyHeuristic(text: string): Model | null {
  const t = text.trim();
  if (!t) return 'haiku';
  if (t.length > 400) return 'sonnet'; // prompt longo: mais provável ser tarefa grande
  if (COMMIT_MESSAGE.test(t) && t.length < 80) return 'haiku';
  if (SONNET_HINTS.test(t)) return 'sonnet';
  if (HAIKU_HINTS.test(t) && t.length < 200) return 'haiku';
  return null;
}

export const CLASSIFY_SYSTEM_PROMPT = `Você é um classificador de complexidade de tarefas pra um roteador de modelo. Leia a mensagem do usuário e responda com UMA ÚNICA PALAVRA, sem explicação:
- "haiku" se for uma pergunta factual simples, confirmação, leitura/explicação de algo já existente, tarefa trivial de 1 passo, ou só geração de texto sobre algo já na conversa (mensagem de commit, resumo, tradução, reescrever um texto).
- "sonnet" se exigir escrever ou editar código, mudar múltiplos arquivos, planejamento, raciocínio sobre arquitetura, ou qualquer ambiguidade sobre o que fazer.
Na dúvida, responda "sonnet".`;

// Learned routing: the classifier's verdict for short gray-zone prompts, so a repeated prompt ("generate commit message",
// "roda os testes") skips the classifier call next time. Plain JSON { normalizedPrompt: model } in the data dir —
// edit or delete an entry to correct a wrong verdict. Only short prompts: long ones rarely repeat verbatim.
const LEARNED_FILE = path.join(DATA_DIR, 'routing-learned.json');
const LEARNED_MAX_LEN = 200;
const LEARNED_CAP = 500; // ponytail: oldest-first eviction by insertion order; LRU if hit rates ever matter
let learned: Record<string, Model> | undefined;
let writing: Promise<void> = Promise.resolve();

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');

function learnedMap(): Record<string, Model> {
  if (!learned) {
    try { learned = JSON.parse(readFileSync(LEARNED_FILE, 'utf8')) as Record<string, Model>; } catch { learned = {}; }
  }
  return learned;
}

export function learnedRoute(text: string): Model | null {
  const m = learnedMap()[normalize(text)];
  return m === 'haiku' || m === 'sonnet' ? m : null;
}

export function learnRoute(text: string, model: Model): void {
  const key = normalize(text);
  if (!key || key.length > LEARNED_MAX_LEN) return;
  const map = learnedMap();
  delete map[key]; // re-insert at the end so eviction drops the oldest
  map[key] = model;
  for (const k of Object.keys(map).slice(0, Math.max(0, Object.keys(map).length - LEARNED_CAP))) delete map[k];
  const json = JSON.stringify(map, null, 2);
  writing = writing
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
      await fs.writeFile(LEARNED_FILE, json, { mode: 0o600 });
    })
    .catch((err) => console.error(`[routing] could not save the learned routes: ${(err as Error).message}`));
}
