# MeshTrim design system

MeshTrim is a developer workbench, with compact controls and generous preview space.
The initial page shows honest empty states; no sample savings or simulated optimization.

## Palette: 60 / 30 / 10

- 60% graphite canvas: `hsl(210 20% 9%)`.
- 30% raised surfaces: `hsl(210 17% 13%)`, with `hsl(210 14% 17%)` controls.
- 10% lime accent: `hsl(78 79% 68%)`, reserved for selection and primary status.
- Main text: `hsl(60 13% 94%)`; secondary text: `hsl(210 12% 72%)`.
- Borders: `hsl(210 12% 28%)`; error: `hsl(8 90% 76%)`.
- Text on lime uses the graphite canvas token. Normal text must meet 4.5:1 contrast.

## Typography

Bahnschrift for headings and identity; Trebuchet MS for body and controls.
Use deliberate local font stacks (DIN Alternate / Arial Narrow and Verdana fallbacks)
with no external font requests. This keeps the scaffold usable offline and on Windows.
Body size 16px, line height 1.5; captions 12px or greater.

## Spacing, shape, and elevation

Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48px, expressed as CSS variables.
Controls use 8px corners; panels 12px; small status pills may use full rounding.
Panels use borders rather than shadows. Elevated controls use one subtle shadow.

## Interaction and accessibility

Mobile-first single-column layout; paired previews at 760px and wider.
Minimum target 44px, visible 2px lime keyboard focus with a 3px offset.
Hover brightens the surface; active uses a 1px translation; disabled remains readable.
Health checks show loading, success and actionable error states in a polite live region.
Uploads use a labeled native file input and a separate submit button; drag and drop
is an optional shortcut. Validation errors stay next to the input. Library rows are
buttons with a selected state. Asset links preserve selection through reloads.
Actions show loading text and block duplicate submissions. Destructive deletion
requires an inline confirmation naming the asset, with a keyboard-accessible cancel.
Empty comparison panels explain the actual API capability: inspection is available;
3D rendering and worker execution are subsequent tasks. Queued jobs never imply savings.
Reports use stored byte counts, including negative savings; absent data stays absent.
Inspection tables wrap names and become stacked rows on narrow screens.
Transitions last 180ms and never animate width or height. Respect reduced motion.
Use semantic buttons, a labeled preset radio group, a skip link and decorative SVG icons.

## Guidance provenance

Applied the installed ui-ux-pro-max skill for task 3.
The ui-ux-pro-max search now runs successfully and recommends a dark developer
workspace with high contrast and visible focus. Keep the existing graphite/lime
palette and local font pairing for continuity and offline use. The suggested
marketing sections do not fit this task; the asset workbench is the main page.
Selection and job status always include text, alongside color. Pending detail
requests clear old controls; later responses cannot replace a newer selection.

## Task 3 component rules

Keep the upload, preset and library rail separate from the inspection workspace.
Library selection uses a lime border, an inset marker and `aria-pressed`.
Reports show three measured values, with tabular numerals; unavailable output
uses descriptive text. Job badges spell out every state. Failed jobs and field
errors use the error token. Deletion confirmation uses a bordered error surface.
Downloads are 44px-tall links with the same focus and hover treatment as buttons.
Long filenames wrap everywhere. File inputs and version controls fit the rail;
tables become labeled rows below 600px. `[hidden]` always removes its contents.
Primary buttons keep dark text on a lime surface in every enabled state.
Step markers and refresh actions retain their minimum size beside long filenames.
The skip link stays outside the viewport until keyboard focus, including after scrolling.
