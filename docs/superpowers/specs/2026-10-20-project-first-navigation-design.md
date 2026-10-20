# Project-first navigation — design

Date: 2026-10-20. Status: draft for approval. Frontend-only except one optional field on `Project`.
Visual companion mockups: `flow-overview.html` (brainstorm session; the screens below match it).

## Intent

Today every project and session lives in one always-visible sidebar next to the chat. The user wants each project to be its own *ecosystem*: open the app, see a catalog of projects, enter one, see its tools and sessions, enter a session, chat. Each level is a **full-screen layer that covers the previous one** (no sidebar, no side-by-side grouping) with a Back button and smooth transitions. The result should feel fluid, modern, and keep the existing Vercel-like black/white palette (`web/DESIGN.md`, "The Quiet Console").

## Goals

- Five levels: **Home → (Remote picker) → Project hub → Sessions → Chat**, each full-screen, Back button top-left of every level except Home.
- Home is a fluid **card catalog** (not a list). Each card has a distinct accent color that appears only as a discreet hover glow/border and in status dots.
- Project-level actions (MCP, Plugins, project Search, Project settings) live in the Project hub. Session-level actions (the remaining Chat header buttons) live in the Chat header.
- A global, discreet **activity layer** keeps "many sessions, one glance" alive without the sidebar (see below).
- Better **Create project** modal, followed by a **Setup modal** that toggles per-project features.
- Home also exposes **Logs**, **Profile** and **Settings** (today in the sidebar footer).
- Smooth transitions between levels; honor `prefers-reduced-motion`.

## Non-goals / anti-goals

- No backend protocol changes, no new dependency (no router/animation library).
- No multi-tab session strip: **one session at a time** (user decision). Tabs UI is removed.
- Do not touch Model Routing, permission, Opus-gate or runtime logic. Do not touch `web/dist`.
- Must NOT regress: attached sessions keep running and keep reporting when the user leaves the Chat; permission prompts must never be missed because the user is on another screen.
- Anti-goal: a look that drifts from Vercel-style monochrome (no gradients-as-decoration beyond the hover glow, no side stripes, no glassmorphism except the toast blur).

## Screens

### 1. Home (`/`)
- Top bar: "Code Nest", global pills (`N running`, `N needs you`, click opens the activity overlay), Profile, Logs, Settings.
- Fluid grid (`auto-fill, minmax(~210px, 1fr)`): first tile "+ New project" (dashed), then local projects, then one **Remote** tile.
- Project card: name, mono path (truncated), status line (running / asks permission / idle · N open sessions). Hover: lift 2px + colored shadow/border from the project's accent; transition ~250ms.
- Remote tile (violet): "SSH servers · N servers · M online". **Decision (user):** remote projects live on their own page; entering Remote asks which server.
- If no SSH server exists the Remote tile offers "+ Add server" (reuses existing server form).

### 2. Remote picker (`/remote`)
- Grid of SSH connections with status dot (`up/down/reconnecting`), target, project count. Click opens that server's own project catalog (same grid as Home, filtered by `connectionId`, "+ New project" preselects that server). "+ Add server" top-right; remove server action on the card (keep the existing confirm).

### 3. Project hub (`/p/:id`)
- Back to Home. Breadcrumb `Home / <project>`; primary "+ New session".
- **Project tools** (left): MCP servers, Plugins, Search (project-wide), Settings (existing `ProjectSettingsModal`: bypass, routing, lean, auto-compact, model, effort). Tools open the existing modals.
- **Sessions peek** (right): newest few sessions with state dots, "View all sessions & archive →".
- MCP today is opened from the active session (`openMcp` needs a live session). Builder must verify how MCP/Plugins behave with no active session and choose the least invasive wiring (e.g. open a lightweight session or list from the project config) — see Open decisions.

### 4. Sessions (`/p/:id/sessions`)
- Two lists: **Open** and **Archived** (count each). Row: state dot, name, favorite star, tags, model/cost meta. Existing row actions (rename, tags, favorite, archive/restore) on hover. Click opens Chat.
- Search-by-name/#tag input (reuse `matchRow`) replaces the sidebar search.

### 5. Chat (`/p/:id/s/:sessionId`)
- Back goes to Sessions. Header = `project / session name` + **session-only** buttons: Search (in session), Tasks (background), Status, Export, Terminal, Usage chip, Refresh, Timestamps. MCP and Plugins buttons are removed from here (moved to hub).
- Everything below the header (messages, input, git bar, modals) is unchanged.

### Create project modal
- Segmented Local / Remote (+ server select when Remote), path with Browse (existing `FolderBrowserModal`), name auto-derived from folder (editable), **color swatches** (6–8 presets), Cancel / Create.

### Setup modal (after create)
- Toggles mapped to existing `Project` flags: Bypass permissions (keeps the existing explicit confirmation), Model routing, Lean mode, Auto-compact. Plus Notifications (browser notification opt-in, existing `toggleNotify`). "Skip" and "Open project".

### Activity layer (global, all screens except it self-hides when empty)
- **Toast stack, top-right**, small cards: line 1 `project – session`, line 2 a terse reason ("Waiting for permission: Bash(...)", "Question from Claude", "Finished"). "Needs you" toasts (permission, AskUserQuestion) persist until handled or the session is opened; "Finished" auto-fades (~6s). Click jumps straight to that session's Chat. Toasts for the session currently on screen are suppressed.
- **Pills** in the top bar (Home and hub/sessions): `N running`, `N needs you`; click opens a compact overlay listing those sessions grouped by project, with the same jump behavior. In Chat the bar shows the same pills.
- Data source: existing `chats[*].state` (`running`/`awaiting_permission`) and `attention`; toasts hook into the existing `turn.completed` / `permission.requested` handling in `store.ts handle()` plus the AskUserQuestion event. Browser notifications (`notify`) keep working unchanged.

## Navigation model

- A `view` state in the Zustand store (`home | remote | project | sessions | chat` plus ids) and the browser History API (`pushState`/`popstate`) so the browser/mouse Back button and reload work. The Back button and `Esc`/`Alt+←` call the same `back()`. No router dependency.
- Leaving Chat does **not** detach the session: it stays attached so events keep flowing (the existing `attached`/`tabs` bookkeeping in `store.ts` is kept or reduced to an attached-set; builder decides the minimal change). Detach only on explicit action as today.
- Shortcuts: `Ctrl/Cmd+K` palette stays (retarget it to jump across projects/sessions); `Alt+N` new session stays; `Alt+L` (sidebar) and `Alt+↑/↓` (tab cycle) are removed or repurposed — builder updates `Shortcuts.tsx` accordingly. `Ctrl+J` terminal stays.
- Last location is *not* restored on reload except through the URL (my call: simple, no extra persistence).

## Motion

- Entering a deeper level: new layer fades+slides in from the right (~16px, 220ms, ease-out); Back reverses. The covered layer dims/fades slightly. Cards stagger in once on Home (≤ 30ms steps, capped). CSS transitions/keyframes only; animate `transform`/`opacity`. `prefers-reduced-motion`: cross-fade only.

## Project color

- Add optional `color?: string` (hex) to `Project` in `shared/src/index.ts`, persisted by the existing project add/patch path. Projects without one get a deterministic color from a fixed palette by hashing `id` (so existing projects get colors with no migration). Color is used only for card hover glow, status accents on that project's screens, and the swatch.

## Constraints

- Strict TypeScript, Tailwind 4, existing tokens in `web/DESIGN.md`/`index.css`; reuse existing modals (`ProjectSettingsModal`, `McpModal`, `PluginsModal`, `SearchModal`, `FolderBrowserModal`, `ServerForm`, `ProfilePage`, `LogsPage`, `AppSettingsModal`). Keep keyboard operability and light/dark/system themes working (accessibility is binding in `PRODUCT.md`).
- Project rule: all new/changed code, comments and UI copy in **English**. My call: translate Portuguese strings only in components this work creates or substantially rewrites (not a repo-wide pass).
- Extend `server/test/` only if the `color` field touches server code; run `npm run typecheck`, `npm test`, `npm run test:live` before any commit/push (project rule).

## Decisions made by me (check these)

1. Remote = gateway tile → server picker → server's catalog (my reading of the user's answer).
2. Project hub exists as its own level (mockup 3); can be collapsed into Sessions later.
3. Color is user-chosen at creation with hash fallback, stored on `Project`.
4. Store-based navigation + History API, no router library.
5. Toasts for "needs you" persist; "finished" auto-fades.
6. Sidebar, `Tabs.tsx`, `layout.sidebar*` store fields and `Alt+L` are deleted once the new flow is in.

## Open decisions for the builder (verify in code first)

- How MCP/Plugins work from the hub without an active session (`openMcp` is session-bound today).
- Exact event name/shape for AskUserQuestion to feed the "needs you" toast.
- Whether `ProfilePage`/`LogsPage` (currently view-state flags `ui.profile`/`ui.logs`) fit as navigation levels or stay overlays opened from Home.
- Migration of `ccui-layout` localStorage (`sidebar`, `sidebarW`, `collapsed`) — drop silently.
- Docs to update on completion: `docs/frontend.md`, README feature list.
