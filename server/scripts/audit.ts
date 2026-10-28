import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Project, SessionMeta } from '@ccui/shared';
import { verdicts, renderSummary } from '../src/audit-verdict';
import { markAnalyzed, readAllAudits, refreshSessionAudit, slugify } from '../src/audit-store';
import { DATA_DIR } from '../src/store';

// `npm run audit`: builds the missing/stale per-session reports from the session logs, then prints one verdict per
// token-saving feature (compact, Model Routing, handoff). Free: no Claude process. Read-only on the app's state, so it
// is safe while the backend runs. Flags: --reanalyze (rebuild every report), --project <name> (filter by project name).
const args = process.argv.slice(2);
const force = args.includes('--reanalyze');
const only = args.includes('--project') ? slugify(args[args.indexOf('--project') + 1] ?? '') : null;

const readJson = async <T>(file: string, d: T): Promise<T> => { try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf8')) as T; } catch { return d; } };
const sessions = (await readJson<{ sessions: SessionMeta[] }>('sessions.json', { sessions: [] })).sessions;
const projects = new Map((await readJson<{ projects: Project[] }>('projects.json', { projects: [] })).projects.map((p) => [p.id, p.name]));

for (const s of sessions) await refreshSessionAudit({ sessionId: s.sessionId, projectId: s.projectId, projectName: projects.get(s.projectId) ?? 'project' }, { force });

const all = (await readAllAudits()).filter((a) => !only || a.projectName && slugify(a.projectName) === only);
const fresh = all.filter((a) => !a.analyzedAt || force);
const v = verdicts(all);
console.log(renderSummary(v));
console.log(`\n${fresh.length} new session(s) analyzed, ${all.length - fresh.length} already analyzed`);
await fs.writeFile(path.join(DATA_DIR, 'audit', 'summary.json'), JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
if (force) for (const a of all) a.analyzedAt = null;
await markAnalyzed(all);
