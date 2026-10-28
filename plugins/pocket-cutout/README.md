# Pocket Cutout

A [gSender](https://github.com/Sienci-Labs/gsender) plugin that clears a rectangular or
round pocket. GRBL-safe output: `G0`/`G1`, plus `G2`/`G3` arcs for circles and rounded
corners (switch to **Lines (G1)** under *More options* if your controller rejects arcs).
No canned cycles, no cutter compensation.

- **Shape** – a rectangle (width, height and a corner radius) or a circle (diameter).
  A corner radius of `0` leaves the tool's own radius in the corners, since a round bit
  can't cut a sharp inside corner; the plugin tells you.
- **Depth and stepdown** – the pocket is cut in levels of at most the stepdown, each
  level a little deeper than the last.
- **No plunge** – every level starts at the middle of the pocket with a **helical ramp**
  (at most about 5° steep, so a deep level takes more than one turn), followed by one flat
  lap at full depth to clean the sloped floor the ramp leaves. The only straight vertical
  move is the short drop onto the floor the previous level already cleared.
- **Spiral** – each level clears from the middle outwards and ends on the wall. A round
  pocket is one continuous spiral followed by a circle on the wall. A rectangle is
  concentric rings; each ring is joined to the next by a **lane change**: a diagonal
  S-curve of two gentle arcs along a long straight side, so the bit never turns sharply
  to step over. **Stepover** is a fraction of the tool diameter (rings are never more
  than half a tool diameter apart).
- **Spiral direction** – clockwise (climb milling, usually the better finish inside a
  pocket) or counter-clockwise (conventional).
- **Zero** – tap the centre or any corner of the little diagram (for a circle, its
  bounding square); the G-code is shifted so X0 Y0 sits there. Z0 is the stock top.
- Slow / Medium / High speed presets, mm or inches, **Load to gSender**.

The tool centre stays one tool radius inside the pocket wall the whole time, so it never
cuts outside the pocket. The unit tests check this, and also that every point the tool
can reach is cut at full depth, for every shape, spiral direction and arcs on or off.

```bash
npm install                 # at the repo root
npm run dev     # standalone with a mocked gSender bridge
npm test
npm run build   # produces ui/, which gSender serves
```
