import { useCallback, useEffect, useState } from 'react';
import type { PlanUsage, ProfileView, UsageBreakdown, UsageWindow } from '@ccui/shared';
import { api } from '../../api';
import { Modal, primary, secondary } from '../../lib/Modal';

const HOUR = 3_600_000;
const section = 'mb-2 font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-500';
const card = 'rounded-lg border border-zinc-800 bg-zinc-950/40 p-4';

const BEHAVIORS: Record<string, [string, string]> = {
  cache_miss: ['Cache perdido', 'Requisições que não aproveitaram o cache e reprocessaram o contexto inteiro.'],
  long_context: ['Contexto longo', 'Conversas com muito contexto acumulado; cada mensagem custa mais.'],
  subagent_heavy: ['Muitos subagentes', 'Turnos que dispararam vários subagentes.'],
  high_parallel: ['Alto paralelismo', 'Muitas sessões ou chamadas rodando ao mesmo tempo.'],
  cron: ['Tarefas agendadas', 'Execuções automáticas (loops, rotinas agendadas).'],
};

const tone = (pct: number) => (pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500');
const text = (pct: number) => (pct >= 90 ? 'text-rose-400' : pct >= 70 ? 'text-amber-400' : 'text-emerald-400');

function duration(ms: number) {
  if (ms <= 0) return 'agora';
  const m = Math.round(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return [d && `${d}d`, h && `${h}h`, (!d && min) && `${min}min`].filter(Boolean).join(' ') || '< 1min';
}
function when(t: number, now: number) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `hoje às ${time}`;
  if (days === 1) return `amanhã às ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'long', day: '2-digit', month: '2-digit' })} às ${time}`;
}

function Bar({ pct, className = 'h-2' }: { pct: number; className?: string }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      <div className={`h-full rounded-full ${tone(pct)}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

// one rate-limit window: usage, reset countdown, elapsed share of the window and a linear projection of the current pace
function Window({ title, hint, w, windowMs, now }: { title: string; hint: string; w: UsageWindow | null | undefined; windowMs: number; now: number }) {
  if (!w || w.utilization === null) {
    return <div className={card}><div className="text-sm font-medium text-zinc-200">{title}</div><div className="mt-1 text-xs text-zinc-500">Sem dados para esta janela.</div></div>;
  }
  const pct = w.utilization;
  const reset = w.resets_at ? Date.parse(w.resets_at) : null;
  const start = reset !== null ? reset - windowMs : null;
  const elapsed = start !== null ? Math.min(1, Math.max(0, (now - start) / windowMs)) : null;
  // ponytail: linear pace; bursty use makes the projection jumpy early in the window
  let pace: string | null = null;
  if (elapsed !== null && elapsed > 0.03 && pct > 0 && start !== null && reset !== null) {
    const projected = pct / elapsed;
    pace = projected >= 100
      ? `No ritmo atual, chega a 100% ${when(start + windowMs * (100 / projected), now)} (${duration(reset - (start + windowMs * (100 / projected)))} antes do reset).`
      : `No ritmo atual, termina a janela em ~${Math.round(projected)}%.`;
  }
  return (
    <div className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-zinc-200">{title}</div>
          <div className="text-[11px] text-zinc-500">{hint}</div>
        </div>
        <div className={`text-2xl font-semibold tabular-nums ${text(pct)}`}>{Math.round(pct)}%</div>
      </div>
      <Bar pct={pct} className="mt-3 h-2.5" />
      <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
        <span>{Math.round(pct)}% usado</span><span>{Math.max(0, 100 - Math.round(pct))}% restante</span>
      </div>
      {reset !== null && (
        <div className="mt-3 text-xs text-zinc-300">
          Reseta em <span className="font-medium text-zinc-100">{duration(reset - now)}</span> <span className="text-zinc-500">· {when(reset, now)}</span>
        </div>
      )}
      {elapsed !== null && start !== null && (
        <div className="mt-2">
          <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
            <span>Janela iniciada {when(start, now)}</span><span>{Math.round(elapsed * 100)}% do tempo decorrido</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-zinc-500" style={{ width: `${elapsed * 100}%` }} /></div>
        </div>
      )}
      {pace && <div className="mt-2 text-[11px] text-zinc-400">{pace}</div>}
      {w.locked_reason && <div className="mt-2 text-[11px] text-rose-400">Bloqueado: {w.locked_reason}</div>}
    </div>
  );
}

function SubWindow({ label, w, now }: { label: string; w: UsageWindow; now: number }) {
  const pct = w.utilization ?? 0;
  return (
    <div className="py-1.5">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className="tabular-nums text-zinc-400">{Math.round(pct)}%{w.resets_at && <span className="text-zinc-600"> · reseta {when(Date.parse(w.resets_at), now)}</span>}</span>
      </div>
      <Bar pct={pct} className="h-1.5" />
    </div>
  );
}

function Shares({ title, rows }: { title: string; rows: Array<{ name: string; pct: number }> }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-zinc-400">{title}</div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2 text-xs">
            <span className="w-44 truncate font-mono text-[11px] text-zinc-300" title={r.name}>{r.name}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-sky-500" style={{ width: `${Math.min(100, r.pct)}%` }} /></div>
            <span className="w-9 text-right tabular-nums text-zinc-500">{r.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Breakdown({ b }: { b: UsageBreakdown }) {
  const empty = !b.behaviors.length && !b.skills.length && !b.agents.length && !b.plugins.length && !b.mcp_servers.length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-zinc-800 p-3"><div className="text-[11px] text-zinc-500">Requisições</div><div className="text-lg font-semibold tabular-nums text-zinc-100">{b.request_count.toLocaleString()}</div></div>
        <div className="rounded-md border border-zinc-800 p-3"><div className="text-[11px] text-zinc-500">Sessões</div><div className="text-lg font-semibold tabular-nums text-zinc-100">{b.session_count.toLocaleString()}</div></div>
      </div>
      {b.behaviors.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium text-zinc-400">Comportamentos (se sobrepõem, não somam 100%)</div>
          <ul className="space-y-2">
            {b.behaviors.map((x) => {
              const [label, desc] = BEHAVIORS[x.key] ?? [x.key, ''];
              return (
                <li key={x.key}>
                  <div className="flex justify-between text-xs"><span className="text-zinc-200">{label}</span><span className="tabular-nums text-zinc-400">{x.pct}% · {x.count.toLocaleString()} req.</span></div>
                  <div className="my-1 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-violet-500" style={{ width: `${Math.min(100, x.pct)}%` }} /></div>
                  {desc && <div className="text-[11px] text-zinc-500">{desc}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Shares title="Skills" rows={b.skills} />
      <Shares title="Agentes" rows={b.agents} />
      <Shares title="Plugins" rows={b.plugins} />
      <Shares title="Servidores MCP" rows={b.mcp_servers} />
      {empty && <div className="text-xs text-zinc-600">Nada relevante nesta janela.</div>}
    </div>
  );
}

const money = (m: { amount_minor: number; currency: string; exponent: number }) =>
  (m.amount_minor / 10 ** m.exponent).toLocaleString([], { style: 'currency', currency: m.currency });

export function UsageModal({ profile, onClose }: { profile: ProfileView; onClose: () => void }) {
  const [u, setU] = useState<PlanUsage | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<'day' | 'week'>('day');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try { setU(await api.profileUsage(profile.id)); setErr(''); } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }, [profile.id]);
  useEffect(() => { void load(); }, [load]);
  // keeps countdowns live without refetching
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const rl = u?.rate_limits;
  const subs: Array<[string, UsageWindow]> = [];
  for (const [label, w] of [['Sonnet', rl?.seven_day_sonnet], ['Opus', rl?.seven_day_opus], ['Apps OAuth', rl?.seven_day_oauth_apps], ...(rl?.model_scoped ?? []).map((m) => [m.display_name, m])] as Array<[string, UsageWindow | null | undefined]>) {
    if (w && w.utilization !== null) subs.push([label, w]);
  }
  const products = rl?.seven_day_breakdown?.rows.filter((r) => r.percent > 0) ?? [];
  const extra = rl?.extra_usage;
  const spend = rl?.spend;

  return (
    <Modal
      size="lg" onClose={onClose} title={`Uso do plano · ${profile.name}`}
      subtitle={<>{String(profile.status?.email ?? '')}{u?.subscription_type && <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-300">{u.subscription_type}</span>}</>}
      actions={<div className="flex items-center gap-3">
        {u && <span className="text-xs text-zinc-600">atualizado {new Date(u.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
        <button className={secondary} disabled={loading} onClick={() => void load()}>{loading ? 'Atualizando…' : 'Atualizar'}</button>
      </div>}
      footer={<button className={primary} onClick={onClose}>Fechar</button>}
    >
        {err && <div className="mb-3 text-sm text-rose-400">{err}</div>}
        {!u && loading && <div className="text-sm text-zinc-500">Consultando o uso…</div>}
        {u && !u.rate_limits_available && (
          <div className="mb-3 text-xs text-zinc-400">Limites do plano indisponíveis para esta conta (chave de API, Bedrock/Vertex ou login sem o escopo de perfil).</div>
        )}

        {rl && (
          <div className="space-y-3">
            <div className={section}>Limites</div>
            <Window title="Sessão (5 horas)" hint="Janela contínua de 5h a partir da primeira mensagem" w={rl.five_hour} windowMs={5 * HOUR} now={now} />
            <Window title="Semanal (7 dias)" hint="Todos os modelos" w={rl.seven_day} windowMs={7 * 24 * HOUR} now={now} />

            {subs.length > 0 && (
              <div className={card}>
                <div className="mb-1 text-sm font-medium text-zinc-200">Semanal por modelo</div>
                {subs.map(([label, w]) => <SubWindow key={label} label={label} w={w} now={now} />)}
              </div>
            )}

            {products.length > 0 && (
              <div className={card}>
                <div className="mb-2 text-sm font-medium text-zinc-200">Onde o limite semanal foi gasto</div>
                <Shares title="" rows={products.map((r) => ({ name: r.display_name, pct: r.percent }))} />
              </div>
            )}

            <div className={card}>
              <div className="text-sm font-medium text-zinc-200">Créditos extras</div>
              {extra?.is_enabled ? (
                <div className="mt-2 space-y-1 text-xs text-zinc-300">
                  {extra.utilization !== null && <Bar pct={extra.utilization} />}
                  <div>Usado: {spend?.used ? money(spend.used) : (extra.used_credits ?? '—')} {spend?.limit ? `de ${money(spend.limit)}` : extra.monthly_limit !== null ? `de ${extra.monthly_limit}` : ''} por mês</div>
                </div>
              ) : (
                <div className="mt-1 text-xs text-zinc-500">Desativados: ao bater o limite, o uso para até o reset.{spend?.used && spend.used.amount_minor > 0 ? ` Gasto no período: ${money(spend.used)}.` : ''}</div>
              )}
              {spend?.disclaimer && <div className="mt-2 text-[11px] text-zinc-600">{spend.disclaimer.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}</div>}
            </div>
          </div>
        )}

        {u?.behaviors && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <div className={section + ' mb-0'}>O que está consumindo (neste computador)</div>
              <div className="flex gap-1">
                {(['day', 'week'] as const).map((r) => (
                  <button key={r} className={`rounded px-2 py-0.5 text-[11px] ${range === r ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'}`} onClick={() => setRange(r)}>{r === 'day' ? '24 horas' : '7 dias'}</button>
                ))}
              </div>
            </div>
            <div className="mb-3 text-[11px] text-zinc-600">Estimativa pelos transcripts locais do Claude Code; não inclui outros dispositivos nem o claude.ai.</div>
            <Breakdown b={u.behaviors[range]} />
          </div>
        )}

    </Modal>
  );
}
