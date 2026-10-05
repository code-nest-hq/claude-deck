import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uuidSchema } from '@ccui/shared';
import { DATA_DIR } from './store';

// Per-session Deck-side log: <data dir>/session-logs/<sessionId>.jsonl, one JSON line per thing the app did or saw in
// that session (events, actions, process lifecycle, routing verdicts, compaction requests). The Claude Code transcript is
// NOT copied here: the export merges it in on demand (see export.ts). Same append-only chain as logs.ts.
const DIR = path.join(DATA_DIR, 'session-logs');
const fileOf = (sessionId: string) => path.join(DIR, `${sessionId}.jsonl`);

export interface SessionLogLine { ts: string; kind: string; [k: string]: unknown }

let chain: Promise<void> = Promise.resolve(); // appends in order

/** never throws: a log failure must not break the session */
export function recordSession(sessionId: string, kind: string, fields: Record<string, unknown> = {}, at = Date.now()): void {
  if (!uuidSchema.safeParse(sessionId).success) return; // the id becomes a file name
  const line = JSON.stringify({ ts: new Date(at).toISOString(), kind, ...fields }) + '\n';
  chain = chain
    .then(async () => {
      await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
      await fs.appendFile(fileOf(sessionId), line, { mode: 0o600 });
    })
    .catch((err) => console.error(`[session-log] could not write: ${(err as Error).message}`));
}

/** resolves once everything recorded so far is on disk */
export const flushSessionLog = () => chain;

/** lines of one session, oldest first; a torn last line (crash mid-write) is skipped; unknown session = [] */
export async function readSessionLog(sessionId: string): Promise<SessionLogLine[]> {
  if (!uuidSchema.safeParse(sessionId).success) return [];
  await chain;
  const text = await fs.readFile(fileOf(sessionId), 'utf8').catch(() => '');
  return text.split('\n').flatMap((l) => { try { return l ? [JSON.parse(l) as SessionLogLine] : []; } catch { return []; } });
}
