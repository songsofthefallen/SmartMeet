# UI Context

## Theme

Dark-only SmartMeet interface with a premium editorial identity and a precise scheduling command-center hierarchy. The visual anchor is the departure desk: an ink-dark field, layered slate surfaces, restrained cool-blue navigation and actions, and clear event time typography. Do not add a light mode.

All interface colors live in CSS custom properties in `app/globals.css` and are mapped through Tailwind v4's CSS-first `@theme inline`. Use semantic tokens in components instead of arbitrary colors or raw Tailwind color palettes.

| Role | CSS Variable | Value |
|---|---|---|
| Page background | `--background` | `#0A1119` |
| Surface | `--surface` | `#111B26` |
| Subtle surface | `--surface-secondary` | `#172432` |
| Hover surface | `--surface-hover` | `#1D3041` |
| Default border | `--border` | `#2A3A49` |
| Primary text | `--text-primary` | `#E7EEF5` |
| Secondary text | `--text-secondary` | `#B3C0CC` |
| Muted text | `--text-muted` | `#8797A7` |
| Brand accent | `--brand-primary` | `#79AFFF` |
| Brand hover | `--brand-hover` | `#9AC3FF` |
| Brand subtle | `--brand-subtle` | `#182D46` |
| Cyan accent | `--brand-cyan` | `#5BCBFF` |
| Cyan subtle surface | `--brand-cyan-subtle` | `#112D3E` |
| Violet accent | `--brand-violet` | `#9B8EFF` |
| Violet subtle surface | `--brand-violet-subtle` | `#262241` |
| Error | `--state-error` | `#FF9797` |
| Error background | `--state-error-bg` | `#3B2228` |
| Success | `--state-success` | `#7BD9A5` |
| Success background | `--state-success-bg` | `#19362A` |
| Warning | `--state-warning` | `#F0C474` |
| Warning background | `--state-warning-bg` | `#3A301E` |

Use blue for primary actions and active navigation, green for confirmed success, amber for warnings, and red for errors or destructive actions. Statuses need readable text or an icon; never rely on color alone.

## Typography

Use the centralized system sans stack unless a bundled typeface is deliberately adopted. Establish hierarchy with scale, weight, line length, and spacing rather than decorative labels. Keep event times tabular and easy to scan.

- Page headings: confident, compact, and left aligned.
- Body text: readable with calm line spacing.
- Supporting text: muted, while maintaining accessible contrast.
- Numeric time and route values: tabular numerals.

## Shape and surfaces

Use restrained radii for controls and small status markers. Reserve bordered surfaces for related controls, map frames, and genuinely grouped data. Prefer spacing, alignment, and dividers to repeated cards. Avoid gradients, glow effects, and decorative borders.

## Components and icons

Use Lucide React (`lucide-react`) with consistent stroke weight. Icon-only controls need accessible names and visible focus. Use semantic tokens for all component states. Do not add a component library unless a specific requirement justifies it.

## Layout patterns

- **Public landing page:** spacious centered header and editorial two-column hero/account composition on desktop. The hero may use an optimized local night-map illustration behind real HTML copy, with the route summary explicitly labeled as illustrative. Arrange compact icon highlights in an even row on wide screens and stack the hero, highlights, and Clerk account panel on narrow screens.

- **Shared signed-in shell:** persistent desktop navigation rail; compact horizontal navigation on mobile; consistent account access and clear current-page indication.
- **Dashboard:** daily overview led by the next known event and supported planning information.
- **Schedules:** chronological event management with a separate focused schedule creation workspace.
- **Saved Places:** dedicated aliases and location management with its interactive map.
- **Settings:** supported notification controls and preferences.
- **Responsive behavior:** preserve readable content width; stack secondary information on mobile; keep all navigation and controls keyboard reachable.

Do not show a schedule as saved until the backend confirms persistence. Never display invented travel, departure, wake-up, or weather information.

## Accessibility and motion

Use semantic landmarks, visible keyboard focus, accessible labels, and text or icons alongside status color. Respect reduced-motion preferences. Keep active navigation distinguishable without color alone.

## Design rules

Maintain the SmartMeet dark-only token system. Use typography, spacing, alignment, and restrained blue accents to create hierarchy. Keep the page useful at desktop and mobile widths and preserve established schedule, route, weather, notification, and map behavior during visual changes.
