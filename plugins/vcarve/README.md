# V-Carve

A [gSender](https://github.com/Sienci-Labs/gsender) plugin that carves text, vector shapes
and pictures with a V-bit, the way signs and nameplates are made. The bit follows the centre
line of each shape and goes **deeper where the shape is wide and shallower where it is
narrow**, so the walls are cut cleanly right up to the edge, and corners come out as sharp
points. GRBL-safe output: `G0`/`G1` only, in the same style as the other plugins.

## How to use it

1. **Artwork**
   - **Text**: type it, pick a font (Roboto Bold, Roboto Slab Bold and Bebas Neue are
     built in, or load your own `.ttf`, `.otf` or `.woff`), set the letter height.
   - **SVG**: choose a vector drawing and set its width or height. Closed shapes are carved,
     and a shape inside another one is a hole, like the inside of an O. Open lines have no
     inside and are left out (you're told).
   - **Picture**: choose a PNG or JPG of a logo or line drawing. It is turned to black and
     white; move the **threshold** slider until the live preview shows exactly what you want
     carved, and use **Invert** to carve the light areas instead of the dark ones. Set the
     real size by width or height (a picture has no size of its own).
2. **V-bit**: included angle, maximum diameter and tip diameter (0 for a sharp point). They
   start at common values (60°, 12.7 mm, sharp tip) so you can begin straight away; check
   them against your bit and change them. The cutting length is optional. A picture of your
   bit appears as you type, with its angle, tip, widest point and deepest cut, next to the
   groove it makes at the maximum depth, so a wrong value is easy to spot.
3. **Cutting**: the maximum depth is **worked out for you**, as the deepest this bit can cut
   (from its angle, diameter, tip and cutting length), and shown. You can enter a smaller
   limit to protect thin stock, and clear the box to go back to automatic; the cut is never
   deeper than the limit in force. Then the feed, plunge, spindle speed and safe Z, and the
   quality (draft, normal or fine). Optionally switch on **Roughing pass, then a finishing
   pass** (off by default): the first pass cuts a little shallower, so every groove comes out
   narrower and leaves the **wood left on the walls** you set (from 0, measured sideways at
   the surface, 0.2 mm to start with). The finishing pass then cuts to the final size at a
   percentage of the cutting feed (60% to start with) for a cleaner wall. All the roughing is
   cut first, then all the finishing. It takes about twice as long, and the time estimate
   shows it. With 0 left, the second pass simply repeats the first more slowly.
4. **Zero**: tap the centre or a corner of the artwork's bounding box to put X0 Y0 there. Z0
   is the top of the stock.
5. Press **Preview**. You get the toolpath and a summary (the deepest cut the artwork needs,
   the deepest the bit can cut, and the maximum you set), with any problems in the strip
   above the buttons. If everything is fine, **Load to gSender** (or **Show G-code**) is
   available. Change anything and the preview has to be redone first.

## What it will and won't do

The plugin protects you from bad cuts and says in plain words what is wrong:

- A cleared box, an angle outside 1° to 179°, a tip as wide as the bit, a negative or zero
  diameter: it refuses to continue and names the value.
- A **depth limit deeper than the bit can cut** is refused, and the deepest allowed value
  is shown. (The deepest cut is where the cone reaches its full diameter, or the end of the
  cutting edge if you entered a cutting length.)
- A shape **too wide for the bit at the depth limit** gives a **warning and no G-code**. The
  warning says where, by how much, and in how many places, and the places are circled in red
  on the artwork. Use a bigger or wider-angle bit, allow more depth if the stock is thick
  enough, or make the artwork smaller or thinner.
- **Parts thinner than the bit's tip** are reported: a flat tip can't cut to a point.
- **The toolpath is never deeper than the depth limit**, whatever the settings: it is
  clamped when planned, and the G-code writer refuses to write anything deeper (or anything at
  all, if the artwork is too wide).
- A picture that looks like a **photo** gets a warning (V-carving wants clean logos, line art
  and text); an all-one-colour picture is an error.

## How it works

For each shape the plugin finds the **medial axis**, the line of points equally far from
two edges, and the distance from each of its points to the nearest edge (the radius `r`).
The bit's depth there is `(r - tip/2) / tan(angle/2)`. At a sharp convex corner `r` falls
to zero, so the cut comes to a point exactly on the corner. Holes and islands fall out of
this naturally. The axis is found from a Delaunay triangulation of points sampled along the
outline (denser at higher quality), with the spurious branches that sampling adds on curves
removed. The radius of every axis point is then measured exactly, as its distance to the
outline, so the cut is never wider than the shape. This is an approximation whose error
shrinks as you raise the quality; an exact method can replace it later without changing how
the plugin is used.

The axis is cut as long smooth chains (the straightest continuation at each junction), in an
order with few lifts. Cuts start on the surface at a sharp tip, or in a groove that is
already cut, wherever possible, so the bit rarely plunges into uncut material. A disc is the
exception, which is simply a plunge at its centre.

Pictures are blurred a little, traced with sub-pixel accuracy, then smoothed and simplified
so that jagged pixel edges never become wobbly toolpaths.

The unit tests check the result physically: for letters from all three fonts, an SVG, a
picture and the standard test shapes (bar, L, T, star, thin strokes, rings and curves),
they treat the cut as a union of discs and check that it never reaches past a shape's edge
and that it covers the whole shape.

## Fonts

Roboto Bold and Bebas Neue are under the SIL Open Font License 1.1, and Roboto Slab under the
Apache License 2.0. Their licences ship with the plugin in `ui/FONT-LICENSES.txt`. The bundled
fonts have Latin letters only; for other scripts, load a font that has them.

## Limits of this version

- Computing the preview runs on the page itself, so a very large or very detailed drawing
  can make it pause for a few seconds.
- The 3D viewer's *Material* view is not offered here: its simulation models a flat
  cutter, which would misrepresent a V groove. The viewer also can't draw a V-bit with
  your angle and diameter (its markers are a sphere, a fixed cone, a fluted drill, a laser
  and a crosshair), so the bit is not drawn there; the picture in the V-bit section shows it.
- Without roughing, the whole depth is cut in a single pass; there are no stepdowns (more passes at increasing depth) yet.

```bash
npm install                 # at the repo root
npm run dev     # standalone with a mocked gSender bridge
npm test
npm run build   # produces ui/, which gSender serves
```
