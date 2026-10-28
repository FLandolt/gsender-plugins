# Hole Pattern

A [gSender](https://github.com/Sienci-Labs/gsender) plugin that generates
GRBL-compliant G-code for a grid of round holes.

Inputs: tool diameter, hole diameter, hole depth, number of holes in X and Y
(`1` × `1` = one hole, `1` × `2` = two holes along Y) and the spacing between
them. Speed presets are Slow, Medium and High (default High, a fast setting for softwood).

**Work zero** is the centre of the first hole (X0 Y0), **Z0** is the top of the
stock. By default it is the lower-left hole of the grid and the other holes extend in
+X and +Y. For a grid, tap another corner in the diagram to zero on the lower-right,
upper-left or upper-right hole instead; the holes then extend away from that corner.

Output is `G0`/`G1` plus `G2`/`G3` arcs (no canned cycles, no cutter compensation).
Holes are cut one after another, level by level: the bit spirals down in the middle
(on a circle 3/4 of the tool diameter wide) to the level's depth, runs one flat full
circle there (so the helix's ramp is cleaned off the floor), spirals outward to
the wall, runs a full circle on the wall, returns to the middle and repeats for the
next stepdown.

**Circles and corners: Arcs (G2/G3) or Lines (G1)** (under *More options*, Arcs by default): the downward spiral is one
helical `G3` circle per level, the wall is one full `G3` circle (each written as two half-circle arcs, which every controller and viewer handles), and the outward
spiral is a chain of quarter-turn arcs. Arcs use `IJ` centre offsets computed from the
printed numbers, so start and end radius agree. Switch it off to write the same path
as short `G1` chords (about 0.01 mm sag) if your controller rejects arcs. A hole as wide as the tool is
peck-plunged. A 3D preview (gSender's own viewer) sits next to the form.

```bash
npm install                 # at the repo root
npm run dev     # standalone with a mocked gSender bridge
npm test
npm run build   # produces ui/, which gSender serves
```

To use it in gSender, see the install steps in the [main README](../../README.md#install).
For development, link this folder into gSender's `plugins/` directory and run
`npm run build -- --watch`.
