# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo developer on their own machine, running several Claude Code sessions at once, for long working stretches. Backend is loopback-only; the browser is the client. Projects are local or remote over SSH. Job: start, watch, steer and review many sessions without living in terminal tabs.

## Product Purpose

Run and chat with Claude Code sessions from the browser instead of the terminal: streaming chat, multiple tabs/sessions that keep running in the background, history review, project-wide search, MCP/plugin management, profiles (multiple Claude accounts), plan usage, session export. Success: the user keeps many sessions in view and in control, and never has to babysit an SSH tab.

## Positioning

Control plane for many Claude Code sessions at a glance: background sessions, history, search, cost/token visibility, SSH-drop survival, and per-message Haiku/Sonnet model routing. Cost-aware by design: only Haiku and Sonnet are session models; Opus and Fable are blocked (Opus only as a gated read-only architect subagent).

## Operating Context

React 19 + Vite + Tailwind 4 SPA (`web/`), Zustand store, WebSocket client; Hono backend and Agent SDK runtime in `server/`. Sessions live in a sidebar of projects and tabs; chat is the main surface, with modals for MCP, Plugins, usage, export, settings, pasted text.

## Capabilities and Constraints

- Local and SSH projects, folder browser, file attachments, slash commands with autocomplete (some blocked by design), rich input editor, read-only terminal (never accepts input, so permission approval is never bypassed).
- Permission prompts, bypass toggle with explicit confirmation, Lean mode, Model Routing opt-in per project/session.
- Themes: light, dark, system. Keyboard shortcuts and command palette (`Ctrl/Cmd+K`). Browser notifications. Resizable sidebar.
- All UI copy, code and docs in English.

## Brand Commitments

Name: Code Nest. No logo or voice guide recorded.

## Evidence on Hand

Real product only: README feature list and `docs/` in the repo. No testimonials, customers or benchmarks exist; do not fabricate any.

## Product Principles

- Many sessions, one glance: state of every session (running, waiting on permission, done, cost) is readable without opening it.
- Keyboard-first: the command palette and shortcuts are primary paths, not extras.
- Cost is visible, never hidden; safety rails (model block, permission prompts) are explained, not silent.
- Trust the terminal's mental model: mirror Claude Code behavior and terminology rather than inventing new ones.

## Accessibility & Inclusion

Light, dark and system themes must keep working. Keyboard operability is a binding requirement. No other standard established.
