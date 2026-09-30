# Frontend (`web/`)

React + Vite + Tailwind, strict TypeScript. No SPA router — a single layout (Sidebar + Tabs + Chat) driven by global state.

## Structure (`web/src/`)

```
app/App.tsx          visual entry point, global keybindings
app/AppSettingsModal.tsx  global settings (default model/effort, remote SSH servers)
main.tsx              React boot
store.ts              global state (Zustand) + WebSocket lifecycle
ws.ts                 WS client (auto-reconnect)
api.ts                HTTP client + token
notify.ts             Notification API (opt-in, never shows message content)
theme.ts              light/dark/system theme (outside React, localStorage)
features/chat/        Chat, reduce.ts (event reducer), Markdown, GitBar, CommandsPanel,
                       ShellCard, McpCard, SlashMenu, ToolCard, AttachMenu, AskUserQuestionModal
features/sessions/    Tabs, Palette (Ctrl+K), Shortcuts (? modal), NewSessionModal
features/projects/    Sidebar, ProjectSettingsModal (lean/routing/auto-compact/bypass),
                       FolderBrowserModal (pick a folder, or files to attach)
features/spend/       SpendDashboard (today by model/project), ProjectSpendView (drill-down)
features/connect/     ConnectScreen, ServerForm (initial connection setup)
lib/                  commands.ts (slash-command search), format.ts (fmtTokens etc.),
                       search.ts (normalization/matchRow)
```

## State (`store.ts`)

Zustand, a single global store (`useApp`, the only hook — no per-feature local hooks). Holds: config, projects, `tabs`, `chats` (per `sessionId`), UI state (palette/help/newSession/terminal). The WebSocket is created inside `start()` and reattached on reconnect. Layout preferences (sidebar visibility, collapsed groups) persist in `localStorage` under the `ccui-` prefix.

Main actions: `open()`, `closeTab()`, `send()` (includes the session's staged attachments), `interrupt()`, `answer()`, `shell()`, `mcp(id?, action?)`, `addAttachment()`/`removeAttachment()`.

## WebSocket

`ws.ts`: `createSocket(handlers)` connects to `/ws`, authenticates with `{ type:'auth', token }`, reconnects with exponential backoff (500ms-5s).

`store.ts` (the message handler) dispatches `snapshot` (hydrated via `applySnapshot`) and `event` (via `applyEvent`, both in `features/chat/reduce.ts` — a pure reducer, the same `Chat`/`Item` shape used across the whole chat UI).

`answer(reqId, allow, updatedInput?)` sends `{ type:'permission', sessionId, reqId, allow, updatedInput }` — used both for normal permission approval and for the `AskUserQuestion` modal.

## Model Routing UI

`reduce.ts`: a `turnPhase: 'idle' | 'routing' | 'thinking'` field on `Chat`. `routing.started` -> `routing`; `model.routed` -> `thinking` (stores `pendingRoutedModel`, attached to the user's next message as `Item.routedModel`); any real content event goes back to `idle`. `Chat.tsx` renders `TurnLoading` (animated dots + timer) with a different label per phase.

## Patterns / extension points

- **Components**: `PascalCase`, exported function (or `memo()` when re-render is expensive, e.g. `Markdown`).
- **Chat reducer**: protocol changes to events go into `features/chat/reduce.ts` (`applyEvent`) — the only place that translates `EventBody` -> `Item`/`Chat`. Don't duplicate that logic in components.
- **Types**: always imported from `@ccui/shared`, never duplicated locally.
- **Storage keys**: `ccui-` prefix (`ccui-theme`, `ccui-notify`, layout).
- **Search/filter**: `lib/search.ts` (`norm` + `matchRow`) is reused by `Palette` and the session list — don't reimplement text normalization in another component.

## Notable components

| Feature | File | Note |
|---|---|---|
| Markdown | `features/chat/Markdown.tsx` | `react-markdown` + `remark-gfm` + `rehype-highlight`, memoized (avoids re-render on every streaming delta) |
| Tabs | `features/sessions/Tabs.tsx` | dot color = session state (amber=awaiting_permission, pulsing blue=running, green=new event, gray=idle) |
| Git bar | `features/chat/GitBar.tsx` | fetches `/api/projects/{id}/git`, refreshes at the end of each turn |
| Read-only terminal | `features/chat/CommandsPanel.tsx` | shows `!` commands and per-Task (subagent) tabs; doesn't accept input — a deliberate decision, see `docs/architecture.md` |
| Slash autocomplete | `features/chat/SlashMenu.tsx` | ranking: prefix > alias > name contains > description contains, max 40 items |
| Composer | `features/chat/Chat.tsx` | height-resizable box with attach button and staged-files bar; a mirror div behind a transparent-text textarea colors the `/command` (blue = exists, red = unknown) and the `!` prefix; `/mcp` and `!cmd` are intercepted in `submit()` and never reach the model |
| `/mcp` panel | `features/chat/McpCard.tsx` | servers grouped by scope, status icons like the terminal; click for details, tools, Reconnect/Enable/Disable; needs-auth claude.ai connectors link to claude.ai settings |
| Logs | `features/logs/LogsPage.tsx` | Daily error log, live (`logs` in the store); filter by day, project, level, free text / error ID. The error ID under a chat error opens it here |
| Session status | `features/chat/StatusModal.tsx` | "Status" button in the chat header: read-only session ID (copy), path, connection, profile, effective model/effort/routing/permissions (`GET /api/projects/:id/sessions/:sid/status`, resolved by `openSpecFor`), context occupancy, tokens and cost |
| Project settings | `features/projects/ProjectSettingsModal.tsx` | Lean, Model Routing, Auto-compact (`chat/AutoCompactModal.tsx`), permission bypass (confirmation required, red badge when active) |
| Folder browser | `features/projects/FolderBrowserModal.tsx` | `GET /api/connections/:id/browse`; folder mode for new projects, file mode for attachments |
| Spend dashboard | `features/spend/SpendDashboard.tsx` | today's total/by model/by project; drill-down lists recent sessions and can open a Haiku+routing "validate spend" session |
| AskUserQuestion modal | `features/chat/AskUserQuestionModal.tsx` | single/multi-select + free text, answer sent via `updatedInput` |
| Command palette | `features/sessions/Palette.tsx` | Ctrl/Cmd+K, searches sessions + global actions (new session, theme, sidebar, terminal) |

## Global shortcuts

Defined in `app/App.tsx`: Ctrl/Cmd+K (palette), Alt+N (new session), Alt+L (sidebar), Alt+Up/Down (switch tab), Ctrl+J (terminal), `?` (help), Esc (close modal). Full, up-to-date list in `features/sessions/Shortcuts.tsx`.
