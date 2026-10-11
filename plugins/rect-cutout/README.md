# Rectangular Cutout

A gSender plugin that cuts a rectangle — as an opening in the material or as a
part — with an adjustable corner radius and holding tabs. GRBL-safe output
(`G0`/`G1` only).

- **Size and corner radius** – width, height, one radius for all four corners
  (`0` = sharp).
- **Opening or part** – the bit runs on the inside or outside of the line, so
  the finished rectangle is exactly the size you typed. A round bit can't cut
  sharp *inside* corners; the plugin warns and uses the tool radius instead.
- **No plunge** – the bit ramps down along the outline, one stepdown per lap,
  then runs one flat lap at full depth.
- **Tabs** – 1–4 per straight side, with length and height. Sides too short for
  them are skipped, with a warning.
- **Zero** – centre or lower-left corner of the rectangle; Z0 is the stock top.
- **Climb or conventional** direction, same feed presets as the other plugins.

```bash
npm install                                     # at the repo root
npm run dev --workspace plugins/rect-cutout     # standalone, mocked gSender
npm test --workspace plugins/rect-cutout
npm run build --workspace plugins/rect-cutout   # → plugins/rect-cutout/ui
```
