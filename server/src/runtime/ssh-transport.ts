import { claudeExpr, DEFAULT_CLAUDE_PATH, encodeCwd, explainSshError, runSsh, SESSION_ID_RE, shq, sshArgv } from '../ssh-util';
import { spawnManaged } from './child';
import { SHELL_MAX_OUTPUT, SHELL_TIMEOUT_MS } from './local-transport';
import { costCheckpoints, firstPrompt, lastCostState, parseHistory } from './jsonl';
import type { Transport } from './types';

const LIST_LIMIT = 50;
const HEAD_BYTES = 16 * 1024;
const HISTORY_LINES = 5000;

export function sshTransport(conn: { target: string; claudePath?: string }): Transport {
  const { target } = conn;
  const claude = claudeExpr(conn.claudePath ?? DEFAULT_CLAUDE_PATH);
  const titles = new Map<string, { mtime: number; title: string }>(); // (id, mtime) -> primeiro prompt; evita reler o head a cada polling
  const dir = (cwd: string) => `"$HOME/.claude/projects/${encodeCwd(cwd)}"`;
  const sh = (cmd: string, timeoutMs = 15_000) => runSsh(target, cmd, { timeoutMs });

  return {
    spawn(o, onStderr) {
      // Nenhuma variável de ambiente é encaminhada: o remoto usa o próprio ambiente e login.
      // `o.command` (binário local do SDK) é ignorado; os args do SDK seguem e vão entre aspas simples.
      const remote = `cd ${shq(o.cwd ?? '.')} && exec ${claude} ${o.args.map(shq).join(' ')}`;
      return spawnManaged('ssh', sshArgv(target, remote), { env: process.env, signal: o.signal }, onStderr);
    },

    async isDirectory(p) {
      return (await sh(`test -d ${shq(p)}`)).code === 0;
    },

    async listDir(p) {
      const cmd = p ? `cd ${shq(p)} 2>/dev/null && pwd && ls -1p .` : `cd "$HOME" && pwd && ls -1p .`;
      const r = await sh(cmd);
      if (r.code !== 0) return null;
      const lines = r.stdout.split('\n');
      const resolved = lines[0];
      if (!resolved) return null;
      const entries = lines.slice(1).filter(Boolean).map((l) => (l.endsWith('/') ? { name: l.slice(0, -1), isDir: true } : { name: l, isDir: false }));
      return { path: resolved, entries };
    },

    async readFile(p, maxBytes) {
      const sizeR = await sh(`stat -c %s ${shq(p)} 2>/dev/null`);
      const size = Number(sizeR.stdout.trim());
      if (sizeR.code !== 0 || !Number.isFinite(size) || size > maxBytes) return null;
      const r = await sh(`base64 -w0 ${shq(p)}`, 30_000);
      return r.code === 0 ? r.stdout.trim() : null;
    },

    async tailFile(p, bytes) {
      const r = await sh(`tail -c ${Math.floor(bytes)} ${shq(p)}`);
      return r.code === 0 ? r.stdout : null;
    },

    async listSessions(cwd) {
      const r = await sh(`cd ${dir(cwd)} 2>/dev/null && stat -c '%Y %n' -- *.jsonl 2>/dev/null`);
      const files = r.stdout.split('\n').flatMap((l) => {
        const m = /^(\d+) ([0-9a-f-]{36})\.jsonl$/i.exec(l.trim());
        return m && SESSION_ID_RE.test(m[2]) ? [{ id: m[2], mtime: Number(m[1]) * 1000 }] : [];
      }).sort((a, b) => b.mtime - a.mtime).slice(0, LIST_LIMIT);

      const missing = files.filter((f) => titles.get(f.id)?.mtime !== f.mtime);
      if (missing.length) {
        const cmd = `cd ${dir(cwd)} && for f in ${missing.map((f) => `${f.id}.jsonl`).join(' ')}; do echo "@@@ $f"; head -c ${HEAD_BYTES} "$f"; echo; done`;
        const h = await sh(cmd, 30_000);
        for (const part of h.stdout.split(/^@@@ /m).slice(1)) {
          const nl = part.indexOf('\n');
          const id = part.slice(0, nl).trim().replace(/\.jsonl$/, '');
          const f = missing.find((x) => x.id === id);
          if (f) titles.set(id, { mtime: f.mtime, title: firstPrompt(part.slice(nl + 1)) ?? '' });
        }
      }
      return files.map((f) => ({ sessionId: f.id, summary: titles.get(f.id)?.title || '(sem título)', lastModified: f.mtime }));
    },

    async history(id, cwd) {
      if (!SESSION_ID_RE.test(id)) return [];
      const r = await sh(`tail -n ${HISTORY_LINES} ${dir(cwd)}/${id}.jsonl`, 30_000);
      return r.code === 0 ? parseHistory(r.stdout) : [];
    },

    async sessionExists(id, cwd) {
      return SESSION_ID_RE.test(id) && (await sh(`test -f ${dir(cwd)}/${id}.jsonl`)).code === 0;
    },

    // Comando digitado pelo usuário (modo `!`): interpretado de propósito pelo shell remoto do próprio usuário, no diretório do projeto.
    // O `{ …\n}` mescla stderr em stdout na ordem e impede que um comentário no fim do comando engula o fechamento.
    async shell(cwd, command) {
      const r = await sh(`cd ${shq(cwd)} && { ${command}\n} 2>&1`, SHELL_TIMEOUT_MS);
      if (r.code === 255) return { output: explainSshError(r.stderr, target, r.code), exitCode: null, truncated: false };
      const timedOut = r.code === null;
      return {
        output: r.stdout.slice(0, SHELL_MAX_OUTPUT) + (timedOut ? `\n[tempo limite de ${SHELL_TIMEOUT_MS / 1000} s: comando encerrado]` : ''),
        exitCode: r.code, truncated: r.stdout.length > SHELL_MAX_OUTPUT,
      };
    },

    async costCheckpoints(id, cwd) {
      if (!SESSION_ID_RE.test(id)) return null;
      const r = await sh(`tail -c 8388608 ${dir(cwd)}/${id}.jsonl 2>/dev/null`, 30_000);
      return r.code === 0 ? costCheckpoints(r.stdout) : null;
    },

    async usage(id, cwd) {
      if (!SESSION_ID_RE.test(id)) return null;
      const r = await sh(`tail -c 4194304 ${dir(cwd)}/${id}.jsonl 2>/dev/null | grep -a '"type":"cost-state"' | tail -n 1`, 30_000);
      return r.code === 0 ? lastCostState(r.stdout) : null;
    },

    async git(cwd) {
      const r = await sh(`GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false -C ${shq(cwd)} status --porcelain=v2 --branch 2>/dev/null`);
      return r.code === 0 ? r.stdout : null;
    },

    async waitSessionIdle(id, timeoutMs) {
      if (!SESSION_ID_RE.test(id)) throw new Error('sessionId inválido');
      const pattern = `[${id[0]}]${id.slice(1)}`; // o colchete evita casar o próprio pgrep/shell
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const r = await sh(`pgrep -f ${shq(pattern)}`);
        if (r.code === 1) return; // nenhum processo
        if (r.code !== 0) throw new Error('não foi possível consultar o servidor remoto');
        await new Promise((res) => setTimeout(res, 1000));
      }
      throw new Error('a sessão ainda está ativa no servidor remoto');
    },
  };
}
