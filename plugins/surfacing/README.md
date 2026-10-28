# Surfacing

A [gSender](https://github.com/Sienci-Labs/gsender) plugin that surfaces (faces) a
rectangular area with straight passes. GRBL-safe output: `G0`/`G1` only, no arcs, no
canned cycles.

- **Area** – width (X), height (Y), tool diameter, depth and stepover (as a fraction
  of the tool diameter). Passes are spaced evenly across the area and never further
  apart than the stepover, so the last pass lands exactly on the far edge.
- **Start corner** – click a corner of the little diagram: where the first pass begins. The arrows show how the first pass runs and where it steps over.
- **Passes run along** X or Y. Together with the start corner this gives all eight
  ways of starting (four corners, two directions). The first pass always runs away
  from the start corner and the stepover always moves into the area; the card
  spells it out ("First pass runs right along the bottom edge, then steps up").
- **Turns** – *Outside*: every pass runs 1.1 × the tool diameter past the edge, so the
  sideways step happens in the air and the first plunge is in the air as well.
  *Inside*: passes stop on the edge and the step is cut straight along it; the bit
  plunges into the material at the start corner.
- **Passes** – *Back and forth* (snake): each pass cuts the opposite way, joined by
  the step. *Same direction*: the bit lifts after every pass and returns, so every
  pass cuts the same way (a more uniform finish, slower).
- **Depth** – cut in levels of at most the stepdown; each level repeats the whole
  pattern from the start corner.
- Same Slow / Medium / High speed presets as the other plugins, mm or inches.

**Work zero (X0 Y0)** is picked on a second diagram: any of the four corners or the
centre. By default it follows the start corner, so tapping a start corner puts zero
there too; pick another spot afterwards if you zero the machine somewhere else. The
G-code is simply shifted, the passes do not change. **Z0** is the top of the stock.
The centre of the bit travels over the whole area, so the area is cleared right up to
its edges and the bit reaches up to half a diameter beyond them.

```bash
npm install                 # at the repo root
npm run dev     # standalone with a mocked gSender bridge
npm test
npm run build   # produces ui/, which gSender serves
```
