import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ANALYSIS_VERSION, buildSessionAudit, type SessionAudit } from './audit';
import { readSessionLog, sessionLogBytes } from './session-log';
import { DATA_DIR } from './store';

// Token audit, storage: <data dir>/audit/<project slug>/<sessionId>/audit.json (+ audit.md). Lives in the Deck's data dir,
// never in the audited project. Same atomic-write habit as store.ts (tmp + rename), private modes like session-log.ts.
const ROOT = path.join(DATA_DIR, 'audit');

/** filesystem-safe folder name for a project name: [a-z0-9-] only, so it cannot escape ROOT */
export function slugify(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || 'project';
}
export const auditDir = (projectName: string, sessionId: string) => path.join(ROOT, slugify(projectName), sessionId);

async function write(a: SessionAudit): Promise<void> {
  const dir = auditDir(a.projectName, a.sessionId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [name, text] of [['audit.json', JSON.stringify(a, null, 2) + '\n'], ['audit.md', renderMd(a)]] as const) {
    const file = path.join(dir, name);
    await fs.writeFile(file + '.tmp', text, { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
  }
}

function renderMd(a: SessionAudit): string {
  const done = a.compacts.filter((c) => c.outcome === 'done');
  return [
    `# Audit: ${a.projectName} / ${a.sessionId}`,
    '',
    `- turns: ${a.totals.turns}, measured cost: $${a.totals.costUsd.toFixed(4)}, turns on unknown models: ${a.totals.unpricedTurns}`,
    `- compacts: ${done.length} done, ${a.compacts.length - done.length} failed` + done.map((c) => `\n  - ${c.by}: ${c.preTokens} -> ${c.postTokens} tokens, ${c.turnsAfter} turn(s) after`).join(''),
    `- routing decisions: ${a.routing.length} (classifier cost $${a.routing.reduce((s, r) => s + r.classifierCostUsd, 0).toFixed(4)})`,
    `- handoff: from ${a.handoff.from?.sessionId ?? 'none'}, to ${a.handoff.to.length} session(s), enrich calls ${a.handoff.generated.length}`,
    '',
    'Facts only; verdicts come from `npm run audit`.',
    '',
  ].join('\n');
}

async function readOne(file: string): Promise<SessionAudit | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as SessionAudit; } catch { return null; }
}

/** builds (or reuses) the report of one session; null when the session has no log. Keeps `analyzedAt` while the log is unchanged. */
export async function refreshSessionAudit(meta: { sessionId: string; projectId: string; projectName: string }, opts: { force?: boolean } = {}): Promise<SessionAudit | null> {
  const logBytes = await sessionLogBytes(meta.sessionId);
  if (!logBytes) return null;
  const existing = await readOne(path.join(auditDir(meta.projectName, meta.sessionId), 'audit.json'));
  if (!opts.force && existing && existing.version === ANALYSIS_VERSION && existing.source.logBytes === logBytes) return existing;
  const audit = buildSessionAudit(await readSessionLog(meta.sessionId), { ...meta, logBytes });
  await write(audit);
  return audit;
}

export async function readAllAudits(): Promise<SessionAudit[]> {
  const out: SessionAudit[] = [];
  for (const proj of await fs.readdir(ROOT).catch(() => [])) {
    for (const sid of await fs.readdir(path.join(ROOT, proj)).catch(() => [])) {
      const a = await readOne(path.join(ROOT, proj, sid, 'audit.json'));
      if (a) out.push(a);
    }
  }
  return out;
}

/** stamps `analyzedAt` on the reports that never had one and rewrites them */
export async function markAnalyzed(audits: SessionAudit[]): Promise<void> {
  const now = new Date().toISOString();
  for (const a of audits) if (!a.analyzedAt) { a.analyzedAt = now; await write(a); }
}
