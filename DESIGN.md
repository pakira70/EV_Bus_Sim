# Design Language — NUC EV Bus Sim

This document defines the design language for this application. Cursor and all contributors MUST read this file before making any visual changes, and MUST NOT deviate without explicit permission.

## Design Philosophy

**Quietly confident, serious software.** This tool is for planners and operators making real operational decisions. It is not a marketing site.

**Information at a glance, without searching.** Every element earns its place by delivering information. Ornamentation is not added. If a design decision does not help the user see the data faster or more clearly, it is rejected.

**Central Command aesthetic.** Dark surfaces, high-contrast data, muted chrome. Data is the content; everything else recedes.

## Data-Ink Ratio (Tuftian Principle)

This application follows Edward Tufte's principle of maximizing the data-ink ratio: the proportion of visual elements devoted to displaying actual data versus decoration, chrome, and labels.

Every visual element must justify its existence by answering: *does this help the user see or understand data?* If the answer is "it's a control" or "it's a border" or "it's a label," that element should be minimized — smaller, lighter, quieter — until it stops competing with the data itself.

Concretely:
- Controls (sliders, buttons, dropdowns) should be small and muted.
- Borders should be subtle; prefer background-color layering over drawn lines.
- Labels should be present but never dominant.
- Axis lines, gridlines, and legends on charts should be removed when possible.
- Whitespace is information; it separates without ornamenting.

This principle resolves conflicts: when in doubt between "more visible" and "less visible," choose less visible.

## Typography

- **Font family:** Inter (Google Fonts), weights 400, 500, 600, 700. Fallback stack defined in `--font-family-sans`.
- **Line-height:** 1.6 for body.
- **Heading hierarchy:**
  - `h1`: 2.25em, weight 600, primary text color. Page title only.
  - `h2`: 1.5em, weight 600, primary text color, has a bottom border in `--color-border`. Section heading. Has `margin-top: 2.5em`.
  - `h3`: 1.1em, weight 600, **secondary text color, UPPERCASE, letter-spacing 0.5px**. Sub-sections and card labels.
- **Table headers and metadata:** 0.9em, weight 600, UPPERCASE, letter-spacing 0.5px, secondary text color.
- **Sub-text / units:** 0.8em, secondary text color. Always paired with a larger primary value.
- **Data values:** 1.8em, weight 700, primary text color (or semantic color).

## Color System

All colors are defined as CSS variables in `:root`. **Never introduce a new color literal.** Always reference the variable.

### Palette

| Variable | Value | Use |
|---|---|---|
| `--color-background` | `#1f2023` | Page background. |
| `--color-surface-1` | `#282a2d` | Cards, tables, inputs. |
| `--color-surface-2` | `#323539` | Hover state, secondary surfaces, inactive bars. |
| `--color-border` | `#43474e` | Borders and dividers. |
| `--color-text-primary` | `#e8eaed` | Primary text and values. |
| `--color-text-secondary` | `#bdc1c6` | Labels, sub-text, inactive UI. |
| `--color-primary` | `#8ab4f8` | Selection, interaction, active state. Used sparingly. |
| `--color-primary-hover` | `#a5c5f9` | Hover only. |
| `--color-green` | `#34a853` | Semantic: "good." Use only for best-of / favorable outcomes. |
| `--color-red` | `#ea4335` | Semantic: "bad." Use only for worst-of / unfavorable outcomes. |

### Semantic Color Discipline

- **Green means good. Red means bad.** These colors NEVER appear decoratively.
- **Primary blue means "this is selected or active."** It is NOT used for decoration or emphasis.
- **Charts with multiple series must use a gray scale by default**, with `--color-primary` reserved for the selected or highlighted element. Do NOT use rainbow palettes.

## Semantic Color Exceptions

The donut chart showing "Energy Use by Sub-System" uses a categorical palette (`#FF6384, #FF9F40, #FFCE56, #4BC0C0, #36A2EB`) to distinguish between energy consumers: Heater, HVAC, Traction, Air Compressor, LV Accessories. These colors are **encoding, not decoration** — each color consistently refers to the same sub-system. Preserve this palette and mapping. Do not extend this palette to other charts.

## Opacity as Design Tool

Opacity is a legitimate tool for creating visual hierarchy within the established palette. A `--color-primary` line at 40% opacity is the same color, dimmed — not a new color. Use opacity freely for:
- De-emphasizing unselected data while preserving context (e.g., multiple lines in a time-series chart)
- Creating reference baselines (e.g., fleet average line)
- Hover-state feedback (hovered line bumps to 100%, others dim further)

Do NOT introduce new CSS variables like `--color-primary-dim` for opacity variants. Apply opacity inline via `rgba()`, `opacity:` CSS property, or Chart.js alpha channel.

## Shape Language

- **Border radii** (defined as CSS variables):
  - `--border-radius-sm`: 8px (inputs, dropdowns)
  - `--border-radius-md`: 12px (medium surfaces)
  - `--border-radius-lg`: 16px (cards, chart boxes)
  - `--border-radius-pill`: 9999px (buttons, pills, progress bars)
- **Cards and chart containers** all use `border-radius-lg`, `padding: 25px`, 1px solid `--color-border`.
- **Buttons** use `border-radius-pill`, quiet treatment with `--color-surface-2` background and `--color-text-secondary` text until hover.
- **Shadows:** Defined but used sparingly. Most elevation is communicated through background color layering (surface-1 on background, surface-2 on hover).

## Spacing

- **Container max-width:** 1200px.
- **Card padding:** 25px.
- **Section spacing:** h2 elements have `margin-top: 2.5em`. Maintain this rhythm.
- **Inline gaps:** 20px between related elements (e.g., card columns).

## Interaction Patterns

- **Data is the interface.** Where possible, users interact directly with visualizations (click a bar to select a bus) rather than with separate controls.
- **Selected vs unselected:** Selected elements use `--color-primary`. Unselected elements use gray (`#5F6368` or `--color-surface-2` depending on context).
- **Buttons are quiet.** They do not compete with data for attention.
- **Avoid pulldown selectors** where possible. The design preference is for direct manipulation of data visualizations over indirect controls.

## View-Toggle Pattern (Lozenge Toggle)

When the same data selection supports multiple views, use the established pill-toggle pattern seen in the main navigation (Configuration / Schedule Editor / Fleet Analytics).

- Container: `background: var(--color-surface-1)`, `border-radius: var(--border-radius-pill)`, 8px padding, 1px border in `--color-border`.
- Inactive items: `color: var(--color-text-secondary)`, no background, transparent.
- Active item: `background: var(--color-primary)`, `color: #000` (or appropriate high-contrast text), `border-radius: var(--border-radius-pill)`.
- Transition: smooth background color change, approximately 0.2s ease.

This pattern signals "these are alternative views of the same underlying selection" and is reused across the app.

## State Persistence

User selections (buses, filters, toggle states) MUST persist across all non-selection interactions. Specifically:

- Changing temperature filter → bus selection persists.
- Toggling between Sub-System and Over Time views → bus selection persists.
- Refreshing the page → this is OK to reset (localStorage is not required).

When data updates due to a filter change, existing chart elements should **animate smoothly to new values** (transitioning wedge sizes, line positions) rather than being destroyed and rebuilt. This animation is both a visual polish and an information channel — it lets the user see how a metric changes as they explore.

## Animation Philosophy

Animations are permitted but MUST be understated:
- **Allowed:** Chart build-in (data entering from a neutral state), smooth data transitions when filters change, hover-state fade-ins, pill-toggle background transitions.
- **Not allowed:** Bouncy easing, spinning loaders where a subtle fade works, sliding elements across the screen, anything that calls attention to itself.

Rule of thumb: if the animation is noticeable as an animation, it's too much. The data should appear to move smoothly from one state to another.

## Chart Conventions

- **All charts use Chart.js** with the existing plugins (`chartjs-adapter-date-fns`, `chartjs-plugin-datalabels`).
- **No new chart libraries** without explicit permission.
- **Axes and labels use `--color-text-primary` (`#e8eaed`).**
- **No gridlines unless absolutely needed.** When present, gridlines use `--color-border` with reduced opacity.
- **Legends are avoided where possible.** Prefer direct labeling or interaction-driven highlighting.
- **Chart containers** are wrapped in `.chart-box` to inherit consistent card styling.

## Rules for AI Assistants

When modifying this codebase, you MUST:

1. **Read this file first.** Before writing any CSS or modifying any template, re-read DESIGN.md.
2. **Reference existing patterns.** If a similar component exists (a card, a chart, a button), match its styling exactly.
3. **Never introduce color literals.** Use CSS variables. If the palette does not contain what you need, stop and ask.
4. **Never introduce new fonts, icon sets, or third-party UI libraries** without explicit permission.
5. **Preserve existing interaction patterns.** If the existing page uses click-on-data for selection, do not add separate dropdown controls.
6. **Minimize scope.** Make only the changes requested. Do not "improve" styling, refactor CSS, or restructure HTML as a side effect.
7. **Show diffs before applying** when possible. Every change must be reviewable.

When in doubt: do less. This design language is the product of deliberate work; preserving it is more important than adding features quickly.