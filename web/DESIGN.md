---
name: Code Nest
description: Quiet, dense, terminal-literate console for running many Claude Code sessions.
colors:
  ink-deep: "#09090b"
  ink-surface: "#18181b"
  ink-raised: "#27272a"
  ink-line: "#3f3f46"
  ink-faint: "#71717a"
  ink-muted: "#a1a1aa"
  paper-text: "#e4e4e7"
  paper-bright: "#f4f4f5"
  link-blue: "#60a5fa"
  warn-amber: "#fbbf24"
  ok-emerald: "#34d399"
  error-rose: "#fb7185"
  routing-green: "#22c55e"
  routing-blue: "#3b82f6"
  routing-amber: "#f59e0b"
  opus-violet: "#c4b5fd"
  search-hit: "#c9a00c"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  micro:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.05em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  sm: "2px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
components:
  chip-meta:
    backgroundColor: "{colors.ink-surface}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  sidebar-item-selected:
    backgroundColor: "{colors.ink-raised}"
    textColor: "{colors.paper-bright}"
  sidebar-item:
    textColor: "{colors.ink-muted}"
  modal-scrim:
    backgroundColor: "{colors.ink-deep}"
---

# Design System: Code Nest

## Overview

**Creative North Star: "The Quiet Console"**

A calm, dense instrument panel for people who watch many sessions for hours. Neutrals carry the whole interface; color appears only to signal state (running, waiting, failed, routed model). Type is small, mono wherever the content is code, paths, models or numbers, and borders are hairlines rather than boxes. Nothing decorates; everything reports.

The look is inherited from the terminal it replaces: inverted-scale zinc, no gradients, no illustration, controls that hide until hovered. The light theme is the same system with the zinc scale inverted, not a separate design.

**Key Characteristics:**
- Zinc neutrals for all structure; semantic color for status only.
- Small type (11-14px), mono for machine-ish content.
- Flat tonal layering with hairline borders; shadows only on floating layers.
- Hover-reveal secondary controls; keyboard paths (`Ctrl/Cmd+K`, shortcuts) first-class.
- Dark and light share one component set via variable inversion.

## Colors

Near-black zinc ramp with four status hues. Light theme flips the ramp (`zinc-50` becomes the deepest ink) and swaps accents to their 700-range variants for contrast.

### Primary
- **Bright Paper** (#f4f4f5): selected text, active tab label, the checkbox accent. There is no brand accent; emphasis is lightness.

### Secondary
- **Link Blue** (#60a5fa): markdown links and syntax titles only.

### Tertiary
- **Warn Amber** (#fbbf24): permission waits, caution, numbers in code.
- **Ok Emerald** (#34d399): success, connected.
- **Error Rose** (#fb7185): errors, destructive, failed tools. Tinted fills use 10% alpha with a 20% border.
- **Opus Violet** (#c4b5fd): the gated Opus architect subagent badge, nowhere else.

### Neutral
- **Deep Ink** (#09090b): app background, sidebar.
- **Surface Ink** (#18181b): cards, code blocks, inputs.
- **Raised Ink** (#27272a): selected rows, inline code, hover fills.
- **Line Ink** (#3f3f46): borders, blockquote rule. Hairlines often at 60-70% alpha.
- **Faint Ink** (#71717a): placeholder, comments.
- **Muted Ink** (#a1a1aa): secondary text.
- **Paper Text** (#e4e4e7): body text.

### Named Rules
**The Status-Only Color Rule.** Hue means state. If a colored element is not reporting running, waiting, failed, ok or routed model, make it zinc.

**The Routing Trio Rule.** Blue, amber and green dots (#3b82f6, #f59e0b, #22c55e) belong to the Model Routing turn indicator only.

## Typography

**Display Font:** none; no display type exists.
**Body Font:** system sans (`ui-sans-serif, system-ui`).
**Label/Mono Font:** system mono (`ui-monospace`).

**Character:** Utilitarian system stack. Mono carries identity: model names, paths, cost, tokens and badges read as terminal output.

### Hierarchy
- **Body** (400, 14px, 1.6): chat markdown; max width bounded by the chat column.
- **Label** (400, 12px): the dominant UI size (most controls, rows, menus).
- **Micro** (400, 11px / 10px, tracking 0.05em): badges, counters, metadata.
- **Mono** (400, 12px): code, paths, model chips, cost.
- **Headings in markdown** (600, 20/18/16px): h1-h3 only inside responses.

### Named Rules
**The Machine-Words-Are-Mono Rule.** Paths, commands, model ids, tokens, costs and counts use mono. Prose and labels use sans.

## Layout

Two-pane shell: a resizable left sidebar (projects and sessions, width stored in layout state, collapsible via Alt+L to a thin rail) and a main area with a tab strip over the chat. Chat is a single column with a docked composer. Density is high: row heights of roughly 24-32px, gaps of 4-12px. Modals are centered with a dark scrim. No marketing-style sections exist; no responsive grid is needed beyond a fluid main pane.

## Elevation & Depth

Flat by default. Depth comes from zinc steps (950 shell, 900 surfaces, 800 raised) and hairline borders. Shadows appear only on floating layers.

### Shadow Vocabulary
- **Modal / menu** (`shadow-xl`, scrim `bg-black/60-70`): dialogs and popovers.
- **Selected-row edge** (`inset 2px 0 0 0 zinc-400`): a 2px inner left rule marks the selected sidebar row instead of a fill-only change.
- **Blur** (`backdrop-blur-md`, rare): overlays that sit over chat content.

### Named Rules
**The Flat-At-Rest Rule.** Nothing casts a shadow until it floats above the page.

## Shapes

Small, modest radii: `rounded-md` (6px) is the workhorse, `rounded-lg` (8px) for panels and code blocks, `rounded-sm` (2px) for badges and checkboxes, `rounded-xl` for the occasional dialog, `rounded-full` for dots and pills. Borders are 1px zinc at reduced alpha. No clipped or asymmetric shapes.

## Components

Restrained and terminal-literate: small, hairline-bordered, mono-flavored, hover-revealed.

### Buttons
- **Shape:** 6px radius (`rounded-md`), 1px hairline border, compact padding (about 10px x 4px).
- **Default:** transparent or `zinc-900/50` fill, `zinc-400` text, `zinc-800/60` border.
- **Hover:** border to `zinc-700` or fill to `zinc-900`, text to `zinc-100`.
- **Icon / close:** bare glyph in `zinc-600`, opacity 0 until the parent is hovered.

### Chips
- **Style:** meta chip is mono, 12px, `zinc-900/50` fill, `zinc-800/60` border; micro badges are 10px with tracking and a tinted 10% fill with a 25% border in the status hue.
- **State:** hover raises border to `zinc-700`.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** `zinc-900` over a `zinc-950` shell.
- **Shadow Strategy:** none at rest; see Elevation.
- **Border:** 1px `zinc-800`.
- **Internal Padding:** 8-12px.

### Inputs / Fields
- **Style:** transparent background, no own border when inside a bordered row; 12px `zinc-200` text, `zinc-500` placeholder.
- **Focus:** `outline-none` on the bare input; focus is carried by the container border. Checkbox uses `accent-zinc-100`.
- **Error / Disabled:** rose tint (10% fill, 20% border) for errors.

### Navigation
- **Sidebar rows:** 12px, `zinc-400` text; selected adds `zinc-800/60` fill, `zinc-100` text and the 2px inset left rule; hover `zinc-900`.
- **Tabs:** top strip, close glyph hover-revealed, closing a tab leaves the session running.
- **Collapsed:** 32px rail with a `»` toggle.

### Chat Turn Indicator (signature)
Three 6px dots in blue, amber, green that bob and recolor in sequence (1.2s) while Model Routing is working; a single pulse for plain "thinking".

### Markdown Response
Custom `.md` styles: 1.6 line-height, `zinc-900` code blocks with 1px `zinc-800` border and 8px radius, inline code on `zinc-800`, blue underlined links, tables scroll horizontally. Syntax colors map to purple, green, amber, blue, cyan and follow the theme.

## Do's and Don'ts

### Do:
- **Do** express every neutral through the zinc scale so the light theme's inversion keeps working.
- **Do** keep secondary actions hover-revealed and always reachable by keyboard.
- **Do** use mono for paths, model ids, tokens and costs.
- **Do** use 10% fill plus 20-25% border for status tints.
- **Do** check both themes; light remaps `*-400` accents to `*-700`.

### Don't:
- **Don't** introduce a brand accent color; emphasis is lightness, not hue.
- **Don't** add gradients, glows, illustrations or decorative motion.
- **Don't** use shadows on resting surfaces.
- **Don't** hard-code hex or `white`/`black` in components; use the zinc variables so themes invert.
- **Don't** use the routing trio or Opus violet outside their meanings.
