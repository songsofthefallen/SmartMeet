# UI Context

## Theme

Light mode. Clean, modern productivity UI with a white background, soft blue-gray surfaces, dark navy text, and blue accents. Keep the design minimal, spacious, and easy to scan.

Define all colors as CSS custom properties in `globals.css` and map them to Tailwind theme tokens using the syntax supported by the installed Tailwind version. Components must use semantic tokens instead of hardcoded colors or arbitrary Tailwind color classes.

| Role | CSS Variable | Hex / Value |
|---|---|---|
| Page background | `--background` | `#F6F8FC` |
| Surface | `--surface` | `#FFFFFF` |
| Subtle surface | `--surface-secondary` | `#F1F5F9` |
| Hover surface | `--surface-hover` | `#EAF0F8` |
| Default border | `--border` | `#E2E8F0` |
| Primary text | `--text-primary` | `#0F172A` |
| Secondary text | `--text-secondary` | `#475569` |
| Muted text | `--text-muted` | `#64748B` |
| Brand accent | `--brand-primary` | `#2563EB` |
| Brand hover | `--brand-hover` | `#1D4ED8` |
| Brand subtle | `--brand-subtle` | `#EFF6FF` |
| Error | `--state-error` | `#B91C1C` |
| Error background | `--state-error-bg` | `#FEF2F2` |
| Success | `--state-success` | `#047857` |
| Success background | `--state-success-bg` | `#ECFDF5` |
| Warning | `--state-warning` | `#92400E` |
| Warning background | `--state-warning-bg` | `#FFFBEB` |

Use blue for primary actions and active navigation, green for confirmed success, amber for warnings or assumptions, and red for errors or destructive actions. Statuses must include readable text or an icon; never rely on color alone.

## Typography

Use Geist Sans if already available in the Next.js project; otherwise use a clean system sans-serif font. Keep typography consistent, readable, and centralized through CSS variables.

- Headings: bold, dark navy.
- Body text: regular, dark secondary text.
- Supporting text: muted gray.
- Time displays: use tabular numerals where available.

## Border Radius

Use a consistent radius scale:

| Context | Class |
|---|---|
| Small controls and badges | `rounded-lg` |
| Inputs and buttons | `rounded-xl` |
| Cards and panels | `rounded-2xl` |
| Large dialogs | `rounded-3xl` |

Prefer subtle borders and soft shadows. Avoid excessive gradients, heavy shadows, and unnecessary decoration.

## Component Library

Use shadcn/ui with Tailwind if already installed or selected for the project. Inspect the existing setup before adding dependencies. Keep reusable components in the shared UI directory and use consistent variants for buttons, inputs, cards, dialogs, badges, and alerts.

## Layout Patterns

- **Main assistant:** prominent natural-language input, primary submit button, example prompts, and clear loading, clarification, error, and success states.
- **Dashboard:** simple sidebar navigation and a spacious main content area.
- **Schedule cards:** title, event time, arrival/departure badge, locations, and supported estimates.
- **Schedule details:** grouped event information, locations, timing, notes, and edit/cancel actions.
- **Settings:** clean, separated sections for notifications and preferences.
- **Dialogs:** centered, accessible overlays with a subtle backdrop.
- **Responsive layout:** persistent sidebar on desktop; compact navigation and stacked content on mobile.

Do not show a schedule as saved until the backend confirms persistence. Never display invented travel, departure, or wake-up estimates.

## Icons

Use Lucide React (`lucide-react`) if installed or selected. Use consistent stroke-based icons; avoid mixing icon libraries or using emoji as interface icons.

- Calendar — schedules and events
- Clock — event and reminder times
- Map pin — locations
- Car — travel estimates
- Bell — notifications
- Check circle — successful operations
- Alert triangle — warnings
- Circle alert — errors
- Settings — preferences
- Pencil — editing
- Trash or X — removal or cancellation

Sizes: `h-4 w-4` for inline icons, `h-5 w-5` for buttons and navigation, and `h-8 w-8` for empty-state illustrations. Icon-only buttons must have accessible labels and visible focus states.

## Design Rules

- Keep colors and shared styles centralized so the theme can be changed easily.
- Maintain consistent spacing, typography, and component variants.
- Use visible keyboard focus and accessible form labels.
- Keep the UI calm, readable, and focused on helping users arrive on time.
- Treat the approved Deadline Notifier mockup as the visual reference; this document defines the canonical colors and styling rules.