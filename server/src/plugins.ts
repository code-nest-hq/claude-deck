import type { MarketplaceView, PluginAction, PluginAvailable, PluginsView, PluginView } from '@ccui/shared';
import type { Transport } from './runtime/types';
import { shq } from './ssh-util';

const CATALOG_MAX_BYTES = 8 * 1024 * 1024;

/** `claude plugin …` arguments for an action (already validated by `pluginActionSchema`; every value is shell-quoted) */
export function pluginArgs(a: PluginAction): string {
  const scope = 'scope' in a && a.scope ? ` --scope ${a.scope}` : '';
  switch (a.kind) {
    case 'marketplace.add': return `plugin marketplace add${scope} -- ${shq(a.source)}`;
    case 'marketplace.remove': return `plugin marketplace remove -- ${shq(a.name)}`;
    case 'marketplace.update': return `plugin marketplace update${a.name ? ` -- ${shq(a.name)}` : ''}`;
    default: return `plugin ${a.kind}${scope} -- ${shq(a.plugin)}`;
  }
}

// the CLI may print warnings around the JSON: parse from the first bracket
function parseJson<T>(out: string): T | null {
  const i = out.indexOf('[');
  if (i < 0) return null;
  try { return JSON.parse(out.slice(i)) as T; } catch { return null; }
}

interface RawInstalled {
  id: string; version?: string; scope?: string; enabled?: boolean; projectPath?: string; installedAt?: string; lastUpdated?: string; mcpServers?: Record<string, unknown>;
}
interface RawMarketplace { name: string; source: string; repo?: string; url?: string; path?: string; installLocation?: string }
interface RawCatalogEntry { name?: string; description?: string; category?: string }

/** installed plugins + marketplaces from the CLI, available plugins from each marketplace's catalog file (`list --available` is ~2 MB, over the shell's output cap) */
export async function loadPlugins(t: Transport, run: (args: string) => Promise<string>): Promise<PluginsView> {
  const [listOut, mkOut] = await Promise.all([run('plugin list --json'), run('plugin marketplace list --json')]);
  const rawInstalled = parseJson<RawInstalled[]>(listOut);
  const rawMk = parseJson<RawMarketplace[]>(mkOut);
  if (!rawInstalled || !rawMk) throw new Error(`could not read the plugin list: ${(rawInstalled ? mkOut : listOut).trim().slice(0, 500) || 'no output'}`);

  const catalog = new Map<string, PluginAvailable>();
  await Promise.all(rawMk.filter((m) => m.installLocation).map(async (m) => {
    const b64 = await t.readFile(`${m.installLocation}/.claude-plugin/marketplace.json`, CATALOG_MAX_BYTES).catch(() => null);
    if (!b64) return;
    let plugins: RawCatalogEntry[] = [];
    try { plugins = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).plugins ?? []; } catch { return; }
    for (const p of plugins) {
      if (typeof p.name !== 'string') continue;
      const id = `${p.name}@${m.name}`;
      catalog.set(id, { id, name: p.name, marketplace: m.name, ...(p.description ? { description: p.description } : {}), ...(p.category ? { category: p.category } : {}) });
    }
  }));

  const installed: PluginView[] = rawInstalled.map((p) => {
    const at = p.id.lastIndexOf('@');
    return {
      id: p.id, name: at > 0 ? p.id.slice(0, at) : p.id, marketplace: at > 0 ? p.id.slice(at + 1) : '',
      version: p.version, scope: p.scope, projectPath: p.projectPath, enabled: !!p.enabled,
      description: catalog.get(p.id)?.description, installedAt: p.installedAt, lastUpdated: p.lastUpdated, mcpServers: Object.keys(p.mcpServers ?? {}),
    };
  });
  const have = new Set(installed.map((p) => p.id));
  const marketplaces: MarketplaceView[] = rawMk.map((m) => ({ name: m.name, source: m.source, target: m.repo ?? m.url ?? m.path }));
  return { installed, available: [...catalog.values()].filter((p) => !have.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)), marketplaces };
}
