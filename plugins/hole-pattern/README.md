# Hole Pattern

A [gSender](https://github.com/Sienci-Labs/gsender) plugin that generates
GRBL-compliant G-code for a grid of round holes.

Inputs: tool diameter, hole diameter, hole depth, number of holes in X and Y
(`1` × `1` = one hole, `1` × `2` = two holes along Y) and the spacing between
them. Speed presets are Slow, Medium and High (default High, the Simple Signs softwood values).

**Work zero** is the centre of the first hole (X0 Y0), **Z0** is the top of the
stock. Additional holes extend in +X and +Y.

Output is `G0`/`G1` only (no arcs, no canned cycles). Holes are cut one after
another, level by level: the bit spirals down in the middle (on a circle 3/4 of the tool diameter wide) to the level's depth,
spirals outward to the wall, runs a full circle on the wall, returns to the
middle and repeats for the next stepdown. A hole as wide as the tool is
peck-plunged. A 3D preview (gSender's own viewer) sits next to the form.

```bash
npm install                 # at the repo root
npm run dev     # standalone with a mocked gSender bridge
npm test
npm run build   # produces ui/, which gSender serves
```

Install into gSender the same way as Simple Signs: link this folder into
gSender's `plugins/` directory and run `npm run build -- --watch`.
