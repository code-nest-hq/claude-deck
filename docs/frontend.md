# Frontend (`web/`)

React + Vite + Tailwind, strict TypeScript. No router library — project-first navigation: five full-screen levels (Home → Remote picker / server catalog → Project hub → Sessions → Chat), each covering the previous one, driven by `view` in the store and mirrored in the History API (Back button, `Alt+←` and the browser Back all call `back()`). Spec: `docs/superpowers/specs/2026-10-20-project-first-navigation-design.md`.

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
                       ShellCard, McpModal, SlashMenu, ToolCard, AttachMenu, AskUserQuestionModal
features/home/        Home (project catalog), RemotePicker, ServerCatalog, NewProjectModal (create + setup step),
                       TopBar (Back + breadcrumb), Activity (pills, overlay, toasts), activity.ts (useActivity)
features/sessions/    SessionsPage (open/archived), SessionRowItem, Palette (Ctrl+K), Shortcuts (? modal), NewSessionModal
features/projects/    ProjectHub (project tools + sessions peek), ProjectSettingsModal (lean/routing/auto-compact/bypass),
                       FolderBrowserModal (pick a folder, or files to attach)
features/connect/     ServerForm (add an SSH server)
lib/                  projectColor.ts (project accent: chosen or hashed from id), commands.ts (slash-command search), format.ts (fmtTokens etc.),
                       search.ts (normalization/matchRow)
```

## State (`store.ts`)

Zustand, a single global store (`useApp`, the only hook — no per-feature local hooks). Holds: config, projects, `view` (+ `navDir` for the layer transition), `attachedTo` (sessions opened on this page; they stay attached when you leave the chat), `chats` (per `sessionId`), `toasts` (finished turns), UI state (palette/help/newSession/terminal/activity). The WebSocket is created inside `start()` and reattached on reconnect.

Main actions: `open()` (attaches and navigates to the chat), `go()`, `back()`, `send()` (includes the session's staged attachments), `interrupt()`, `answer()`, `shell()`, `mcp(id?, action?)`, `addAttachment()`/`removeAttachment()`.

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
| Activity | `features/home/Activity.tsx` | pills + overlay + toasts, derived from `chats[*].pending/state` so nothing goes stale; "needs you" toasts persist, "finished" ones fade after 6s; suppressed for the session on screen |
| Git bar | `features/chat/GitBar.tsx` | fetches `/api/projects/{id}/git`, refreshes at the end of each turn |
| Read-only terminal | `features/chat/CommandsPanel.tsx` | shows `!` commands and per-Task (subagent) tabs; doesn't accept input — a deliberate decision, see `docs/architecture.md` |
| Slash autocomplete | `features/chat/SlashMenu.tsx` | ranking: prefix > alias > name contains > description contains, max 40 items |
| Composer | `features/chat/Chat.tsx` | height-resizable box with attach button and staged-files bar; a mirror div behind a transparent-text textarea colors the `/command` (blue = exists, red = unknown) and the `!` prefix; `/mcp` and `!cmd` are intercepted in `submit()` and never reach the model |
| MCP modal (chat header "MCP" button or `/mcp`; session-bound, so it stays in the chat) | `features/chat/McpModal.tsx` | servers grouped by scope, status icons like the terminal; click for details, tools, Reconnect/Enable/Disable; needs-auth claude.ai connectors link to claude.ai settings |
| Plugins modal (header "Plugins" button or `/plugin`) | `features/chat/PluginsModal.tsx` | Installed (enable/disable/update/uninstall), Discover (install with a user/project/local scope), Marketplaces (add/update/remove); talks to `GET/POST /api/projects/:id/plugins` and reloads plugins into the open session after a successful action |
| Rich input (pencil icon) | `features/chat/RichEditor.tsx` | Tiptap email-style editor: B/I/list/code/code block, Enter breaks line, Ctrl+Enter or Send button sends; output is markdown. Plain mode keeps `/` and `!` handling |
| Logs | `features/logs/LogsPage.tsx` | Daily error log, live (`logs` in the store); filter by day, project, level, free text / error ID. The error ID under a chat error opens it here |
| Session status | `features/chat/StatusModal.tsx` | "Status" button in the chat header: read-only session ID (copy), path, connection, profile, effective model/effort/routing/permissions (`GET /api/projects/:id/sessions/:sid/status`, resolved by `openSpecFor`), context occupancy, tokens and cost |
| Session export | `features/chat/ExportModal.tsx` | "Exportar" header button: "mask secrets" checkbox (on by default) + download of the session's full-overview `.jsonl` for analysis by another AI (`api.exportSession` fetches with the bearer token and saves the blob; a plain link would lack the auth header). |
| New session with handoff | `features/chat/HandoffModal.tsx` | Third button of the auto-compact prompt: editable handoff preview (≈ tokens), "enrich with Haiku" checkbox (off by default), then creates a session with the same model/effort/routing and sends the text as its first message. |
| Background tasks | `features/chat/BgTasksModal.tsx` | "Background" header button (only when the session has any; amber with the running count). Step 1: list (status, description, type, elapsed) from `Chat.bgTasks` (`bg.tasks` event / snapshot). Step 2: one task's status, Bash command (looked up by `toolUseId`), summary and output tail polled every 2 s while running (`GET .../bg/:taskId/output`), Stop button (`POST .../bg/:taskId/stop`) |
| Project settings | `features/projects/ProjectSettingsModal.tsx` | Lean, Model Routing, Auto-compact (`chat/AutoCompactModal.tsx`; its prompt states the cost and break-even in messages from `compactBreakEven` in `shared`, calibrated on the token audit), permission bypass (confirmation required, red badge when active) |
| Folder browser | `features/projects/FolderBrowserModal.tsx` | `GET /api/connections/:id/browse`; folder mode for new projects, file mode for attachments |
| AskUserQuestion modal | `features/chat/AskUserQuestionModal.tsx` | single/multi-select + free text, answer sent via `updatedInput` |
| Command palette | `features/sessions/Palette.tsx` | Ctrl/Cmd+K, searches sessions + global actions (new session, theme, sidebar, terminal) |

## Global shortcuts

Defined in `app/App.tsx`: Ctrl/Cmd+K (palette), Alt+N (new session), Alt+L (sidebar), Alt+Up/Down (switch tab), Ctrl+J (terminal), `?` (help), Esc (close modal). Full, up-to-date list in `features/sessions/Shortcuts.tsx`.

## Pasted text attachments

Plain-mode input only. A paste of >= N lines (global setting, `localStorage` key `ccui.pasteLines`, default 600, edited in App Settings) becomes an inline `[Pasted text #id +N lines]` token; the text lives in `Chat` state. Clicking the token in the input opens `PastedModal` editable (Save / Ctrl+Enter updates text and line count). On submit each token is expanded into `<pasted-text id="N">…</pasted-text>`, so the sent bubble (also after reload) renders it as a `PastedChip` that opens the modal read-only. Shell `!cmd` inlines the raw text. Helpers in `web/src/features/chat/pasted.ts`.
