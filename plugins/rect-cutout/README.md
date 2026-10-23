# Rectangular Cutout

A gSender plugin that cuts a rectangle — inside or outside the line, as an opening or a
part — with an adjustable corner radius and holding tabs. GRBL-safe output
(`G0`/`G1` only).

- **Size and corner radius** – width, height, one radius for all four corners
  (`0` = sharp).
- **Inside or outside** – the bit runs on the inside or outside of the line, so
  the finished rectangle is exactly the size you typed. A round bit can't cut
  sharp *inside* corners; the plugin warns and uses the tool radius instead.
- **No plunge** – the bit ramps down along the outline, one stepdown per lap,
  then runs one flat lap at full depth.
- **Tabs** – 1–4 per straight side, with length and height. Choose **trapezoid**
  (default: sloped sides at up to 45°, so the bit climbs over them, easier on the
  cutter; length is measured at the base) or **rectangular** (vertical sides). Sides too short for
  them are skipped, with a warning.
- **Zero** – centre or lower-left corner of the rectangle; Z0 is the stock top.
- **Climb or conventional** direction, same Slow / Medium / High speed presets as the other plugins.

```bash
npm install                                     # at the repo root
npm run dev --workspace plugins/rect-cutout     # standalone, mocked gSender
npm test --workspace plugins/rect-cutout
npm run build --workspace plugins/rect-cutout   # → plugins/rect-cutout/ui
```
