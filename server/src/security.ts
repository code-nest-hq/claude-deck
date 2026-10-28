import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const MCP_OAUTH_PATH = '/mcp-oauth/callback';
export const makeToken = () => process.env.CCUI_TOKEN ?? randomBytes(32).toString('base64url');

export function tokenOk(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Host: bloqueia DNS rebinding. Origin: bloqueia páginas de outros sites (ausente = cliente não-browser, ainda precisa de token).
export function hostOriginOk(port: number, host?: string | null, origin?: string | null): boolean {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  if (process.env.CCUI_DEV_ORIGIN) origins.add(process.env.CCUI_DEV_ORIGIN);
  return !!host && hosts.has(host) && (!origin || origins.has(origin));
}

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*";

export function guard(port: number, token: string): MiddlewareHandler {
  return async (c, next) => {
    if (!hostOriginOk(port, c.req.header('host'), c.req.header('origin'))) return c.text('forbidden', 403);
    if (c.req.path.startsWith('/api/')) {
      const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
      if (!tokenOk(m?.[1], token)) return c.text('unauthorized', 401);
    }
    c.header('Content-Security-Policy', CSP);
    await next();
  };
}
