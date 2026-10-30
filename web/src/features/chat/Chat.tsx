import { useEffect, useMemo, useRef, useState } from 'react';
import type { HandoffTrigger, ModelUsage, SlashCommandInfo } from '@ccui/shared';
import { fmtTokens } from '../../lib/format';
import { useApp } from '../../store';
import { IconArrowLeft, IconLock, IconPaperclip, IconSend, IconShuffle } from '../../lib/icons';
import { ActivityPills } from '../home/Activity';
import { AskUserQuestionModal, isAskUserQuestion } from './AskUserQuestionModal';
import { AttachMenu } from './AttachMenu';
import { AttachmentsModal, NO_ATTACHMENTS } from './AttachmentsModal';
import { AutoCompactModal, ColdCacheModal, ZoneBadge, isColdCache } from './AutoCompactModal';
import { HandoffModal } from './HandoffModal';
import { CommandsPanel } from './CommandsPanel';
import { GitBar } from './GitBar';
import { Markdown } from './Markdown';
import { liveTokens, type Item, type SkillUse } from './reduce';
import { McpModal } from './McpModal';
import { PluginsModal } from './PluginsModal';
import { PastedChip, PastedModal } from './PastedModal';
import { expandPastes, hasPasted, lineCount, splitPasted, pasteThreshold, pasteToken, TOKEN_SPLIT_RE, tokenAt } from './pasted';
import { matchCommands, SlashMenu } from './SlashMenu';
import { bulletize, fenceIfCode, insertBlock, insideFence, onEnter, toMarkdown } from './smartInput';
import { ShellCard } from './ShellCard';
import { SkillsModal } from './SkillsModal';
import { BgTasksModal } from './BgTasksModal';
import { ExportModal } from './ExportModal';
import { jumpTo, SearchModal, sessionSearch } from './SearchModal';
import { StatusModal } from './StatusModal';
import { UsageModal } from './UsageModal';
import { ToolCard } from './ToolCard';

const STUCK_MS = 60_000;
const json = (v: unknown) => JSON.stringify(v, null, 2)?.slice(0, 2000) ?? '';

// error + its log id: click copies it and opens the Logs page filtered by it
function ErrorItem({ text, errorId }: { text: string; errorId?: string }) {
  const setUi = useApp((s) => s.setUi);
  return (
    <div className="whitespace-pre-wrap rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
      {text}
      {errorId && (
        <button
          className="mt-1.5 block font-mono text-[11px] text-rose-400/70 hover:text-rose-200"
          title="Copiar o ID e abrir nos Logs"
          onClick={() => { void navigator.clipboard?.writeText(errorId).catch(() => {}); setUi({ logs: true, profile: false, logFilter: errorId }); }}
        >ID do erro: {errorId}</button>
      )}
    </div>
  );
}

function ItemView({ it, busy, bypass, commands }: { it: Item; busy: boolean; bypass: boolean; commands?: SlashCommandInfo[] }) {
  // mensagens do modo shell/comandos vindas do terminal chegam como blocos de código: renderiza como markdown
  if (it.kind === 'user') {
    const bubble = hasPasted(it.text)
      ? <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 shadow-sm">{splitPasted(it.text).map((p, i) => typeof p === 'string' ? p : <PastedChip key={i} id={p.id} text={p.text} />)}</div>
      : it.text.includes('```')
      ? <div className="ml-auto max-w-[80%] rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 shadow-sm"><Markdown text={it.text} /></div>
      : <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 shadow-sm">{it.text}</div>;
    if (!it.routedModel) return bubble;
    return (
      <div className="ml-auto max-w-[80%]">
        <div className="mb-1 flex items-center justify-end gap-1.5 font-mono text-[11px] text-zinc-500">
          <IconShuffle className="h-3 w-3" />
          roteado → {it.routedModel === 'haiku' ? 'Haiku' : 'Sonnet 5'}
        </div>
        {bubble}
      </div>
    );
  }
  if (it.kind === 'assistant') return <Markdown text={it.text} />;
  if (it.kind === 'error') return <ErrorItem text={it.text} errorId={it.errorId} />;
  if (it.kind === 'shell') return <ShellCard it={it} busy={busy} />;
  if (it.kind === 'mcp') return null; // rendered by McpModal
  if (it.kind === 'turn') return <TurnSummary modelUsage={it.modelUsage} skills={it.skills} subagent={it.subagent} commands={commands} bypass={bypass} />;
  return <ToolCard it={it} />;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (ts: number) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function TurnLoading({ phase, tool, startedAt, now }: { phase: 'routing' | 'thinking'; tool?: string; startedAt: number; now: number }) {
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  const label = phase === 'routing' ? 'Model Routing is helping you' : tool ? `Claude Code is running ${tool}` : 'Claude Code is thinking';
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1 font-mono text-[11px] text-zinc-400">
      <span className="flex items-center gap-0.5"><span className="routing-dot" /><span className="routing-dot" /><span className="routing-dot" /></span>
      {label} … ({secs}s)
    </div>
  );
}

function TurnSummary({ modelUsage, skills, subagent, commands, bypass }: { modelUsage: Record<string, ModelUsage>; skills: SkillUse[]; subagent?: { costUsd: number; tokens: number }; commands?: SlashCommandInfo[]; bypass: boolean }) {
  const [open, setOpen] = useState(false);
  // a typed "/name" only counts when it is a known skill (builtins like /compact aren't skills)
  const used = skills.filter((s) => s.by === 'claude' || commands?.some((c) => c.name === s.name && !c.builtin));
  const cost = Object.values(modelUsage).reduce((s, u) => s + u.costUsd, 0);
  const tok = Object.values(modelUsage).reduce((s, u) => s + u.input + u.output, 0);
  const models = Object.keys(modelUsage).map((id) => id.replace(/^claude-/, '').replace(/-\d{8}$/, '')).join(' + ');
  return (
    <div className="flex items-center justify-center gap-2 text-center font-mono text-[11px] text-zinc-600">
      turno concluído — ${cost.toFixed(4)} · {fmtTokens(tok)} tokens · {models}
      {subagent && cost > 0 && <span title="Estimated at list rates; the part of this turn's cost spent inside subagents">· subagente ~${subagent.costUsd.toFixed(4)} ({Math.min(100, Math.round((subagent.costUsd / cost) * 100))}%)</span>}
      {used.length > 0 && (
        <button className="rounded-sm border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 text-[10px] tracking-wider text-violet-300/90 hover:bg-violet-500/20" onClick={() => setOpen(true)}>
          {used.length === 1 ? 'skill invocada' : `${used.length} skills invocadas`}
        </button>
      )}
      {open && <SkillsModal skills={used} commands={commands} summary={`$${cost.toFixed(4)} · ${fmtTokens(tok)} tokens · ${models}`} onClose={() => setOpen(false)} />}
      {bypass && <span className="rounded-sm border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[10px] tracking-wider text-rose-400/80">bypass</span>}
    </div>
  );
}

function AttachedFilesPill({ sessionId, connectionId }: { sessionId: string; connectionId: string }) {
  const files = useApp((s) => s.attachments[sessionId] ?? NO_ATTACHMENTS);
  const [open, setOpen] = useState(false);
  return (
    <>
      {files.length > 0 && (
        <div className="flex justify-end border-b border-zinc-800/60 px-2 py-1.5">
          <button className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200" onClick={() => setOpen(true)}>
            <IconPaperclip className="h-3 w-3" />{files.length} {files.length === 1 ? 'file' : 'files'}
          </button>
        </div>
      )}
      {open && <AttachmentsModal sessionId={sessionId} connectionId={connectionId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function Chat() {
  const { active, chats, rows, projects, config, status, up, ui, back, send, compactDeclined, shell, mcp, interrupt, answer, setUi, ensureCommands, refreshSession } = useApp();
  const [refresh, setRefresh] = useState<{ state: 'idle' | 'loading' | 'done' | 'error'; msg: string }>({ state: 'idle', msg: '' });
  const chat = active ? chats[active.sessionId] : undefined;
  const project = projects.find((p) => p.id === active?.projectId);
  const commands = useApp((s) => (project ? s.commands[`${project.id}:${project.lean}`] : undefined));
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [handoffTrigger, setHandoffTrigger] = useState<HandoffTrigger | null>(null);
  const [cold, setCold] = useState(false); // a message is waiting on the cold-cache prompt (it stays in the input)
  const [bgOpen, setBgOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [pastes, setPastes] = useState<Record<number, string>>({}); // id -> text behind each "[Pasted text #id +N lines]" token
  const [pastedOpen, setPastedOpen] = useState<number>();
  const [stampsOff, setStampsOff] = useState<Record<string, boolean>>({}); // per session; timestamps are on by default
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat?.items, chat?.pending.length]);
  useEffect(() => { input.current?.focus(); }, [active?.sessionId]);
  // pré-carrega a lista de comandos `/` do projeto (sem custo de tokens); recarrega quando o lean muda
  useEffect(() => { if (project) void ensureCommands(project.id); }, [project?.id, project?.lean, ensureCommands]);

  // menu aberto enquanto o texto é só "/algo" (primeiro token, sem espaço)
  const query = /^\/(\S*)$/.exec(text)?.[1];
  const matches = useMemo<SlashCommandInfo[]>(() => (query === undefined || !commands ? [] : matchCommands(commands, query)), [query, commands]);
  const menuOpen = !dismissed && matches.length > 0;
  // leading "/name" once picked/finished (followed by whitespace, or menu closed): blue if it exists, red if not (visual only)
  const slash = /^\/(\S+)(\s|$)/.exec(text);
  const slashKnown = slash && commands && (slash[2] || !menuOpen) ? commands.some((c) => c.name === slash[1]) : undefined;
  const bang = text.startsWith('!');
  const hasToken = text.includes('[Pasted text #') && TOKEN_SPLIT_RE.test(text);
  const mirrored = bang || (!!slash && slashKnown !== undefined) || hasToken;
  // pasted-text tokens get a chip-like background in the mirror
  const withTokens = (s: string) => s.split(TOKEN_SPLIT_RE).map((part, i) =>
    i % 2 ? <span key={i} className="rounded-sm bg-sky-500/25 text-sky-200 [box-decoration-break:clone]">{part}</span> : part);

  if (!active || !chat) return <div className="flex flex-1 items-center justify-center text-zinc-500">Select or create a session (Ctrl+K)</div>;

  const name = rows[active.projectId]?.find((r) => r.sessionId === active.sessionId)?.name ?? 'Session';
  const busy = chat.state === 'running' || chat.state === 'awaiting_permission';
  const lastItem = chat.items.at(-1);
  const runningTool = lastItem?.kind === 'tool' && lastItem.output === undefined ? lastItem.name : undefined;
  const stuck = chat.state === 'running' && now - chat.lastEventAt > STUCK_MS;
  const connId = project?.connectionId ?? 'local';
  const connState = status[connId] ?? 'up';
  const connLabel = config?.connections.find((c) => c.id === connId)?.label ?? connId;
  const t = chat.totals;
  const inFlight = liveTokens(chat);
  const allTokens = t.input + t.output + t.cacheCreation + t.cacheRead + inFlight;
  const openMcp = () => { setMcpOpen(true); mcp(); };
  const submit = (skipCold = false) => {
    const t = expandPastes(text.startsWith('!') ? text : toMarkdown(text), pastes, !text.trim().startsWith('!')).trim();
    if (!t || !up) return;
    // modo shell: "!comando" roda direto no diretório do projeto (não vai ao modelo)
    if (t.startsWith('!')) { const cmd = t.slice(1).trim(); if (cmd) { shell(cmd); setText(''); setPastes({}); } return; }
    // /mcp: interactive modal like the terminal's panel, instead of the CLI's one-line text summary (not sent to the model)
    if (t === '/mcp') { openMcp(); setText(''); return; }
    if (t === '/plugin' || t === '/plugins') { setPluginsOpen(true); setText(''); return; }
    if (busy) return;
    if (project?.autoCompact && !/^\/compact(\s|$)/.test(t) && !skipCold && isColdCache(chat.context)) { setCold(true); return; }
    send(t); setText(''); setPastes({});
  };
  const sendCold = () => { setCold(false); submit(true); };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    let pasted = e.clipboardData.getData('text');
    const el = e.currentTarget;
    // pasted code is fenced automatically (not in "!shell" / "/command" lines, and not when already inside a block)
    const fenced = !/^[!/]/.test(text) && !insideFence(text, el.selectionStart) ? fenceIfCode(pasted) : null;
    if (fenced) pasted = fenced;
    const lines = lineCount(pasted);
    if (lines < pasteThreshold()) {
      if (!fenced) return;
      e.preventDefault();
      const r = insertBlock(text, el.selectionStart, el.selectionEnd, pasted);
      setText(r.text);
      setTimeout(() => el.setSelectionRange(r.caret, r.caret), 0);
      return;
    }
    e.preventDefault();
    const id = Math.max(0, ...Object.keys(pastes).map(Number)) + 1;
    const tok = pasteToken(id, lines);
    const [a, b] = [el.selectionStart, el.selectionEnd];
    setPastes((p) => ({ ...p, [id]: pasted }));
    setText(text.slice(0, a) + tok + text.slice(b));
    setTimeout(() => el.setSelectionRange(a + tok.length, a + tok.length), 0);
  };
  // edited in the modal: refresh the stored text and the "+N lines" in the token (empty = drop the paste)
  const savePaste = (id: number, v: string) => {
    const re = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`);
    if (v === '') { setPastes(({ [id]: _, ...rest }) => rest); setText((t) => t.replace(re, '')); return; }
    setPastes((p) => ({ ...p, [id]: v }));
    setText((t) => t.replace(re, pasteToken(id, lineCount(v))));
  };
  const pick = (c: SlashCommandInfo) => { setText(`/${c.name} `); setSel(0); input.current?.focus(); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      const cur = matches[Math.min(sel, matches.length - 1)];
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, matches.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); return; }
      if (e.key === 'Tab') { e.preventDefault(); pick(cur); return; }
      // Enter escolhe o comando; se já digitou o nome exato de um comando sem argumento, Enter envia
      const exactNoArg = cur.name === query && !cur.argumentHint;
      if (e.key === 'Enter' && !e.shiftKey && !exactNoArg) { e.preventDefault(); pick(cur); return; }
    }
    const el = e.currentTarget;
    // Enter continues a list / opens a code block / stays a newline inside one; Ctrl+Enter always sends
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing && !bang && el.selectionStart === el.selectionEnd) {
      if (insideFence(text, el.selectionStart)) return;
      const r = onEnter(text, el.selectionStart);
      if (r) { e.preventDefault(); setText(r.text); setTimeout(() => el.setSelectionRange(r.caret, r.caret), 0); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800/60 bg-zinc-950/90 px-4 py-2.5 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <button className="-ml-1.5 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100" title="Back (Alt+←)" onClick={back}><IconArrowLeft className="h-4 w-4" /> Sessions</button>
          <h1 className="min-w-0 truncate text-sm tracking-tight text-zinc-600">{project?.name} / <span className="font-medium text-zinc-100">{name}</span></h1>
        </div>
        <div className="flex items-center gap-3">
          <ZoneBadge ctx={chat.context} onHandoff={() => setHandoffTrigger('zone-badge')} />
          <ActivityPills />
          <button className="hidden items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900 sm:flex" title="Detailed usage (input, output, cache)" onClick={() => setUsageOpen(true)}>
            <span className="text-zinc-300">${chat.totals.costUsd.toFixed(4)}</span>
            <span className="text-zinc-600">·</span>
            <span className={inFlight ? 'text-zinc-200' : ''}>{inFlight ? '~' : ''}{fmtTokens(allTokens)} tokens</span>
          </button>
          {!up && <span className="text-xs text-rose-400">disconnected…</span>}
          {busy && <button className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900" onClick={interrupt}>Pause</button>}
          <button
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${refresh.state === 'error' ? 'border-rose-500/30 text-rose-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'}`}
            disabled={busy || refresh.state === 'loading'}
            title={refresh.msg || 'Reload skills and plugins from disk for this session (e.g. after creating a skill or installing a plugin)'}
            onClick={async () => {
              setRefresh({ state: 'loading', msg: '' });
              try { setRefresh({ state: 'done', msg: await refreshSession() }); } catch (e) { setRefresh({ state: 'error', msg: (e as Error).message }); }
              setTimeout(() => setRefresh((r) => (r.state === 'loading' ? r : { ...r, state: 'idle' })), 3000);
            }}
          >
            {refresh.state === 'loading' ? 'Refreshing…' : refresh.state === 'done' ? 'Refreshed ✓' : refresh.state === 'error' ? 'Refresh failed' : 'Refresh'}
          </button>
          <button className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900" title="Search text in this session" onClick={() => setSearchOpen(true)}>Search</button>
          <button className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900" title="Servidores MCP: status, enable/disable, reconnect" onClick={openMcp}>MCP</button>
          {chat.bgTasks.length > 0 && (() => {
            const running = chat.bgTasks.filter((t) => t.status === 'running').length;
            return (
              <button
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${running ? 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'}`}
                title="Tasks Claude left running in the background"
                onClick={() => setBgOpen(true)}
              >{running ? `● Background ${running}` : 'Background'}</button>
            );
          })()}
          <button className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${stampsOff[active.sessionId] ? 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900' : 'border-zinc-700 bg-zinc-900 text-zinc-100'}`} title="Show/hide message dates and times" onClick={() => setStampsOff((o) => ({ ...o, [active.sessionId]: !o[active.sessionId] }))}>Timestamps</button>
          {project && <button className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900" title="ID, path, model and usage of this session" onClick={() => setStatusOpen(true)}>Status</button>}
          <button className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900" title="Export the full session overview for analysis by another AI" onClick={() => setExportOpen(true)}>Export</button>
          <button className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${ui.term ? 'border-zinc-700 bg-zinc-900 text-zinc-100' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'}`} title="Subagentes e comandos ! (Ctrl+J)" onClick={() => setUi({ term: !ui.term })}>Terminal</button>
        </div>
      </header>
      <GitBar projectId={active.projectId} refreshKey={`${active.sessionId}:${busy ? 'busy' : 'rest'}`} />
      {connState !== 'up' && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-1 text-xs text-amber-400">
          Servidor {connLabel}: {connState === 'down' ? 'sem conexão. O turno em andamento termina no servidor e o histórico completo aparece ao reconectar.' : 'reconectando…'}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {chat.items.map((it, i) => {
          // one timestamp per minute: after each user message, and after the last item of each same-minute run of output
          const next = chat.items[i + 1];
          const showTs = !stampsOff[active.sessionId] && it.ts !== undefined && (it.kind === 'user' || !next || next.kind === 'user' || (next.ts !== undefined && stamp(next.ts) !== stamp(it.ts)));
          if (it.kind === 'mcp') return null; // shown in McpModal, not inline
          return (
            <div key={i} data-i={i} className="space-y-3">
              <ItemView it={it} busy={busy} bypass={!!project?.bypass} commands={commands} />
              {showTs && <div className={`-mt-2 font-mono text-[10px] text-zinc-600 ${it.kind === 'user' ? 'text-right' : ''}`}>{stamp(it.ts!)}</div>}
            </div>
          );
        })}
        {chat.turnPhase !== 'idle' && chat.state !== 'awaiting_permission' && <TurnLoading phase={chat.turnPhase} tool={runningTool} startedAt={chat.turnPhaseAt} now={now} />}
        {chat.pending.filter((p) => !isAskUserQuestion(p)).map((p) => (
          <div key={p.reqId} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 shadow-md">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-3">
              <IconLock className="h-[18px] w-[18px] text-amber-400" />
              <div className="text-xs font-semibold text-zinc-100">
                {p.toolName === 'request_model_upgrade'
                  ? <>Claude quer trocar pra <span className="text-zinc-100">Sonnet 5</span> — {String((p.input as { reason?: unknown } | null)?.reason ?? '')}</>
                  : p.toolName === 'use_opus'
                  ? <>Claude quer usar <span className="text-zinc-100">Opus</span> (background) pra análise arquitetural. Negar usa Sonnet.</>
                  : <>Permitir <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[11px]">{p.toolName}</code>?</>}
              </div>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {p.toolName !== 'request_model_upgrade' && p.toolName !== 'use_opus' && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800/90 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">{json(p.input)}</pre>}
              <div className="flex items-center gap-1.5">
                <button className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-all hover:bg-zinc-200 active:scale-[0.98]" onClick={() => answer(p.reqId, true)}>Permitir</button>
                <button className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400" onClick={() => answer(p.reqId, false)}>Negar</button>
              </div>
            </div>
          </div>
        ))}
        {stuck && <div className="text-xs text-amber-400">Sem atividade há {Math.round((now - chat.lastEventAt) / 1000)} s. Use Interromper se necessário.</div>}
        <div ref={end} />
      </div>

      {ui.term && <CommandsPanel items={chat.items} tasks={chat.tasks} />}

      {(() => {
        const q = chat.pending.find(isAskUserQuestion);
        return q ? <AskUserQuestionModal p={q} onAnswer={(allow, updatedInput) => answer(q.reqId, allow, updatedInput)} /> : null;
      })()}
      {bgOpen && <BgTasksModal projectId={active.projectId} sessionId={active.sessionId} chat={chat} onClose={() => setBgOpen(false)} />}
      {exportOpen && <ExportModal projectId={active.projectId} sessionId={active.sessionId} onClose={() => setExportOpen(false)} />}
      {searchOpen && <SearchModal placeholder="Pesquisar nesta sessão…" search={sessionSearch(chat.items, jumpTo)} onClose={() => setSearchOpen(false)} />}
      {pastedOpen !== undefined && pastes[pastedOpen] !== undefined && <PastedModal id={pastedOpen} text={pastes[pastedOpen]} onClose={() => setPastedOpen(undefined)} onSave={(v) => savePaste(pastedOpen, v)} />}
      {pluginsOpen && project && <PluginsModal projectId={project.id} onClose={() => setPluginsOpen(false)} />}
      {mcpOpen && <McpModal it={chat.items.findLast((x) => x.kind === 'mcp')} onClose={() => setMcpOpen(false)} />}
      {usageOpen && <UsageModal chat={chat} onClose={() => setUsageOpen(false)} />}
      {statusOpen && project && <StatusModal sessionId={active.sessionId} name={name} project={project} config={config} chat={chat} onClose={() => setStatusOpen(false)} />}
      <AutoCompactModal key={active.sessionId} sessionId={active.sessionId} chat={chat} enabled={!!project?.autoCompact} onCompact={() => send('/compact', false, 'auto-compact')} onDecline={compactDeclined} onHandoff={() => setHandoffTrigger('auto-compact-modal')} />
      {cold && chat.context && <ColdCacheModal ctx={chat.context} onSend={sendCold} onCancel={() => setCold(false)} onCompact={() => { setCold(false); send('/compact', false, 'auto-compact'); }} onHandoff={() => { setCold(false); setHandoffTrigger('cold-cache'); }} />}
      {handoffTrigger && <HandoffModal projectId={active.projectId} sessionId={active.sessionId} name={name} trigger={handoffTrigger} onClose={() => setHandoffTrigger(null)} />}

      <div className="relative border-t border-zinc-800/70 bg-zinc-950 p-3">
        {menuOpen && <SlashMenu items={matches} sel={Math.min(sel, matches.length - 1)} lean={!!project?.lean} onPick={pick} onHover={setSel} />}
        <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/90 transition-colors focus-within:border-zinc-700">
          <AttachedFilesPill sessionId={active.sessionId} connectionId={connId} />
          <div className="relative">
            {mirrored && (
              // mirror behind a transparent-text textarea, so only the command token (or "!" shell prefix) gets colored
              <div ref={mirror} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-3 text-sm text-zinc-100 [scrollbar-gutter:stable]">
                {bang
                  ? <><span className="text-red-500">!</span><span className="rounded-sm bg-zinc-300 text-zinc-900 [box-decoration-break:clone]">{text.slice(1)}</span>{' '}</>
                  : slash && slashKnown !== undefined
                    ? <><span className={`underline underline-offset-2 ${slashKnown ? 'text-sky-400' : 'text-red-400'}`}>/{slash[1]}</span>{withTokens(text.slice(slash[1].length + 1))}{' '}</>
                    : <>{withTokens(text)}{' '}</>}
              </div>
            )}
            <textarea
              ref={input}
              className={`block min-h-20 max-h-[50vh] w-full resize-y rounded-t-xl bg-transparent p-3 text-sm outline-none [scrollbar-gutter:stable] placeholder:text-zinc-500 disabled:opacity-50 ${mirrored ? `relative text-transparent ${bang ? 'caret-zinc-900' : 'caret-zinc-100'}` : 'text-zinc-100'}`}
              placeholder={busy ? 'Aguarde a resposta…' : 'Mensagem… ("/" comandos · "!" shell · "- " lista · ``` código · Enter envia · Shift+Enter quebra linha)'}
              value={text}
              disabled={busy || !up}
              onChange={(e) => {
                const el = e.currentTarget;
                const b = (e.nativeEvent as InputEvent).data === ' ' && !el.value.startsWith('!') ? bulletize(el.value, el.selectionStart) : null;
                setText(b ? b.text : el.value); setSel(0); setDismissed(false);
                if (b) setTimeout(() => el.setSelectionRange(b.caret, b.caret), 0);
              }}
              onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onClick={(e) => { const el = e.currentTarget; if (el.selectionStart === el.selectionEnd) { const id = tokenAt(text, el.selectionStart); if (id !== undefined && pastes[id] !== undefined) setPastedOpen(id); } }}
            />
          </div>
          <div className="flex items-center px-1 py-1">
            <AttachMenu sessionId={active.sessionId} connectionId={connId} />
            <span className="flex-1" />
            <button className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40" title="Enviar (Enter · Ctrl+Enter em listas e blocos de código)" disabled={busy || !up || !text.trim()} onClick={() => submit()}><IconSend className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </main>
  );
}
