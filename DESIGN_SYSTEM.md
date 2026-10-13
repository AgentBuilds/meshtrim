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
Preview placeholders explain what will appear; future upload/optimization controls are disabled.
Transitions last 180ms and never animate width or height. Respect reduced motion.
Use semantic buttons, a labeled preset radio group, a skip link and decorative SVG icons.

## Guidance provenance

Applied the installed ui-ux-pro-max accessibility and interaction rules. Its search script
could not run because the Python launcher has no installed interpreter; this palette
and typography are deliberate project choices using the skill's general guidance.
