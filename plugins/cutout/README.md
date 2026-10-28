# Cutout

A gSender plugin that cuts a rectangle or a circle — inside or outside the line, as an
opening or a part — with an adjustable corner radius (rectangles) and holding tabs. GRBL-safe output
(`G0`/`G1`, plus `G2`/`G3` for rounded corners).

- **Shape** – *Rectangle* or *Circle*. A circle takes a diameter; zero is measured on its
  bounding square (centre or any corner).
- **Size and corner radius** – width, height, one radius for all four corners
  (`0` = sharp).
- **Inside or outside** – the bit runs on the inside or outside of the line, so
  the finished rectangle is exactly the size you typed. A round bit can't cut
  sharp *inside* corners; the plugin warns and uses the tool radius instead.
- **Circles and corners: Arcs (G2/G3) or Lines (G1)** – under *More options*, Arcs by default. Rounded corners are
  written as `G2`/`G3` arcs (helical while the bit ramps down); straight sides and
  tabs stay `G1`. Switch it off for short `G1` chords instead, same path to within
  about 0.01 mm.
- **No plunge** – the bit ramps down along the outline, one stepdown per lap,
  then runs one flat lap at full depth.
- **Tabs** – 1–4 per straight side (on a circle: 1–8 tabs spread evenly around it), with length and height. Choose **trapezoid**
  (default: sloped sides at up to 45°, so the bit climbs over them, easier on the
  cutter; length is measured at the base) or **rectangular** (vertical sides). Sides too short for
  them are skipped, with a warning.
- **Zero** – tap the centre or any corner of the little diagram; the G-code is shifted so X0 Y0 sits there. Z0 is the stock top.
- **Climb or conventional** direction, same Slow / Medium / High speed presets as the other plugins.

```bash
npm install                                     # at the repo root
npm run dev --workspace plugins/cutout     # standalone, mocked gSender
npm test --workspace plugins/cutout
npm run build --workspace plugins/cutout   # → plugins/cutout/ui
```
