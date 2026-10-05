import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { ServerMsg } from '@ccui/shared';
import { Connections } from './connections';
import { connectionIdFor, openSpecFor, sessionLabel } from './domain';
import { SessionHub } from './hub';
import { errInfo, logError, logErrorSync, onLog } from './logs';
import { initProfiles } from './profiles';
import { buildApi } from './routes';
import { reportOrphans } from './runtime/local-transport';
import { guard, makeToken } from './security';
import { openStore } from './store';
import { attachWs } from './ws';

const PORT = Number(process.env.CCUI_PORT ?? 4317);
const HOST = process.env.CCUI_HOST ?? '127.0.0.1';
if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.error(`recusado: CCUI_HOST=${HOST} não é loopback`);
  process.exit(1);
}

const store = await openStore();
await initProfiles(store);
reportOrphans();
let broadcast: (m: ServerMsg) => void = () => {};
const conns = new Connections(store, (id, status, message) => broadcast({ type: 'connection.status', id, status, message }));
const hub = new SessionHub((sid) => conns.get(connectionIdFor(store, sid)).runtime, (id) => openSpecFor(store, id), (id) => sessionLabel(store, id));
onLog((entry) => broadcast({ type: 'log', entry }));
// monitor only: logs the crash (sync, the process is going down) without changing Node's default behavior
process.on('uncaughtExceptionMonitor', (err, origin) => {
  logErrorSync({ level: 'error', source: 'process', code: origin, ...errInfo(err), context: { pid: process.pid, node: process.version, uptimeS: Math.round(process.uptime()) } });
});
const token = makeToken();

const app = new Hono();
app.use('*', guard(PORT, token));
app.route('/api', buildApi({ store, hub, conns }));
app.onError((err, c) => {
  const errorId = logError({ level: 'error', source: 'http', code: 'http_500', ...errInfo(err), context: { method: c.req.method, path: c.req.path } });
  return c.json({ error: err.message, errorId }, 500);
});
app.use('/*', serveStatic({ root: './web/dist' }));

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }) as Server;
server.on('error', (e) => { console.error(`[server] ${e.message}`); process.exit(1); });
broadcast = attachWs(server, { port: PORT, token, hub, store, statuses: () => conns.all() }).broadcast;
conns.start();

const url = `${process.env.CCUI_DEV_ORIGIN ?? `http://127.0.0.1:${PORT}`}/#token=${token}`;
console.log(`Code Nest: ${url}`);
// ponytail: só Linux/macOS
if (!process.env.CCUI_NO_OPEN) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await hub.shutdown().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
