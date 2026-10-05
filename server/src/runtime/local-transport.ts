import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { HistoryItem } from '@ccui/shared';
import { spawnManaged } from './child';
import { activeConfigDir } from '../profiles';
import { encodeCwd, SESSION_ID_RE } from '../ssh-util';
import { blockText, cleanTags } from './events';
import { costCheckpoints, jsonlTimestamps, lastCostState } from './jsonl';
import type { Transport } from './types';

export { reportOrphans } from './child';

const sessionFile = (sessionId: string, cwd: string) =>
  path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), 'projects', encodeCwd(cwd), `${sessionId}.jsonl`);

export const SHELL_TIMEOUT_MS = 120_000;
export const SHELL_MAX_OUTPUT = 200 * 1024;

export const localTransport: Transport = {
  // active profile applies at spawn time: sessions already running keep the account they started with
  spawn: (o, onStderr) => {
    const dir = activeConfigDir();
    return spawnManaged(o.command, o.args, { cwd: o.cwd, env: { ...(o.env as NodeJS.ProcessEnv), ...(dir ? { CLAUDE_CONFIG_DIR: dir } : {}) }, signal: o.signal }, onStderr);
  },

  async isDirectory(p) {
    try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
  },

  async listDir(p) {
    const dir = p ?? homedir();
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      return { path: dir, entries: items.map((d) => ({ name: d.name, isDir: d.isDirectory() })) };
    } catch { return null; }
  },

  async readFile(p, maxBytes) {
    try {
      const st = await fs.stat(p);
      if (!st.isFile() || st.size > maxBytes) return null;
      return (await fs.readFile(p)).toString('base64');
    } catch { return null; }
  },

  async tailFile(p, bytes) {
    try {
      const f = await fs.open(p, 'r');
      try {
        const { size } = await f.stat();
        const len = Math.min(size, bytes);
        const buf = Buffer.alloc(len);
        await f.read(buf, 0, len, size - len);
        return buf.toString('utf8');
      } finally { await f.close(); }
    } catch { return null; }
  },

  async listSessions(cwd) {
    const list = await listSessions({ dir: cwd });
    return list.map((s) => ({ sessionId: s.sessionId, summary: s.summary, customTitle: s.customTitle, firstPrompt: s.firstPrompt, lastModified: s.lastModified }));
  },

  async history(sessionId, cwd) {
    let msgs: Awaited<ReturnType<typeof getSessionMessages>> = [];
    try { msgs = await getSessionMessages(sessionId, { dir: cwd }); } catch { /* sessão ainda sem jsonl */ }
    const stamps = await fs.readFile(sessionFile(sessionId, cwd), 'utf8').then(jsonlTimestamps, () => new Map<string, number>());
    return msgs.flatMap((m): HistoryItem[] => {
      if (m.type === 'system') return [];
      const text = cleanTags(blockText((m.message as { content?: unknown } | null)?.content));
      const ts = stamps.get(m.uuid);
      return text ? [{ role: m.type, text, ...(ts ? { ts } : {}) }] : [];
    });
  },

  // the jsonl itself, like the SSH transport: getSessionInfo() returns undefined for real sessions it doesn't list
  // (e.g. one that started with a slash command), and a new process would then fail with "Session ID … is already in use"
  async sessionExists(sessionId, cwd) {
    if (!SESSION_ID_RE.test(sessionId)) return false;
    try { return (await fs.stat(sessionFile(sessionId, cwd))).isFile(); } catch { return false; }
  },

  // Comando digitado pelo usuário (modo `!`): shell de login do usuário, args em array (sem interpolar o texto), grupo próprio para matar tudo no timeout.
  // ponytail: login shell (-l) não lê ~/.zshrc; se faltar PATH do terminal, usar -i (com o risco de prompts interativos)
  shell(cwd, command) {
    return new Promise((resolve) => {
      const child = spawn(process.env.SHELL || 'bash', ['-lc', command], { cwd, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', truncated = false, timedOut = false;
      const add = (d: Buffer) => { if (out.length < SHELL_MAX_OUTPUT) out += d.toString('utf8'); else truncated = true; };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      const t = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* já saiu */ } }, SHELL_TIMEOUT_MS);
      child.on('error', (e) => { clearTimeout(t); resolve({ output: e.message, exitCode: 127, truncated: false }); });
      child.on('close', (code) => {
        clearTimeout(t);
        resolve({ output: out.slice(0, SHELL_MAX_OUTPUT) + (timedOut ? `\n[tempo limite de ${SHELL_TIMEOUT_MS / 1000} s: comando encerrado]` : ''), exitCode: timedOut ? null : code, truncated });
      });
    });
  },

  // lê o fim do jsonl (o `cost-state` é regravado periodicamente); aumenta o trecho até achar
  async costCheckpoints(sessionId, cwd) {
    if (!SESSION_ID_RE.test(sessionId)) return null;
    const file = sessionFile(sessionId, cwd);
    let fh;
    try {
      fh = await fs.open(file, 'r');
      const { size } = await fh.stat();
      const len = Math.min(8 * 1024 * 1024, size);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      return costCheckpoints(buf.toString('utf8'));
    } catch { return null; } finally { await fh?.close(); }
  },

  async usage(sessionId, cwd) {
    if (!SESSION_ID_RE.test(sessionId)) return null;
    const file = sessionFile(sessionId, cwd);
    let fh;
    try {
      fh = await fs.open(file, 'r');
      const { size } = await fh.stat();
      for (const bytes of [256 * 1024, 2 * 1024 * 1024, 16 * 1024 * 1024]) {
        const len = Math.min(bytes, size);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, size - len);
        const found = lastCostState(buf.toString('utf8'));
        if (found || len === size) return found;
      }
      return null;
    } catch { return null; } finally { await fh?.close(); }
  },

  // fsmonitor desligado: um repositório não confiável não executa código ao ser consultado; sem locks para não brigar com o Git do Claude
  git(cwd) {
    return new Promise((resolve) => {
      execFile('git', ['-c', 'core.fsmonitor=false', '-C', cwd, 'status', '--porcelain=v2', '--branch'],
        { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => resolve(err ? null : stdout));
    });
  },

  async waitSessionIdle() { /* local: o processo é nosso e já terminou */ },
};
