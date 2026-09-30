import type { Model } from '@ccui/shared';

// stems match as word prefixes (no trailing \b): "refator" must catch refatorar/refatora, "migrat" migrate/migrating.
// A false hit only costs Sonnet on a simple prompt; a miss costs an extra Haiku classifier call.
const SONNET_HINTS = /\b(implementa|implement|refator|refactor|cri[ae]|creat|constr(?:[oó][ei]|u)|build|arquitet|architect|desenh[ae]|design|corrig[ei].*bug|fix.*bug|migra|migrat|integra|integrat|escreve|write.*(fun[cç][aã]o|function|componente|component|endpoint|feature|teste|test)|planej[ae]|plan)/i;
const HAIKU_HINTS = /^\s*(o que|what is|what's|explica|explain|list[ae]|mostr[ae]|show|confirma|confirm|qual|which|quando|when|resum[ae]|summariz)\b/i;

// null = zona cinzenta: a heurística não decide, precisa da chamada Haiku descartável (ver sdk-runtime.ts classifyViaHaiku)
export function classifyHeuristic(text: string): Model | null {
  const t = text.trim();
  if (!t) return 'haiku';
  if (t.length > 400) return 'sonnet'; // prompt longo: mais provável ser tarefa grande
  if (SONNET_HINTS.test(t)) return 'sonnet';
  if (HAIKU_HINTS.test(t) && t.length < 200) return 'haiku';
  return null;
}

export const CLASSIFY_SYSTEM_PROMPT = `Você é um classificador de complexidade de tarefas pra um roteador de modelo. Leia a mensagem do usuário e responda com UMA ÚNICA PALAVRA, sem explicação:
- "haiku" se for uma pergunta factual simples, confirmação, leitura/explicação de algo já existente, ou tarefa trivial de 1 passo.
- "sonnet" se exigir escrever ou editar código, mudar múltiplos arquivos, planejamento, raciocínio sobre arquitetura, ou qualquer ambiguidade sobre o que fazer.
Na dúvida, responda "sonnet".`;
