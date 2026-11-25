# Height Map

A [gSender](https://github.com/Sienci-Labs/gsender) plugin that carves a picture into stepped levels, like a contour model or a terraced relief map.

Load any picture (colour works too: it is turned to black and white), set how deep the deepest level goes and how many steps down you want. **2 steps give three levels: top, middle and bottom.** The darkest parts of the picture go deepest and the lightest stay at the top of the stock; switch on **Invert** to swap that. A satellite or GIS height map, where light means high, works as it is.

## Settings

1. **Picture**: choose the file, invert it if needed, and set its real size by width or height (the other side follows). **Smoothing** cleans up the levels: it removes specks and smooths ragged edges, but never blurs a sharp edge into extra steps, so a black-and-white picture keeps one straight wall straight down to the bottom. Pick where X0 Y0 is.
2. **Levels & depth**: the number of steps down (1 to 12) and the depth of the deepest level. The levels are spread evenly between the stock top and that depth. The picture's own darkest-to-lightest range is used, so a height map that never reaches pure black or white still uses every level.
3. **Bit**: an end mill's diameter and the stepover.
4. **Speed**: Slow / Medium / High presets or your own feeds. A level deeper than the stepdown is cut in several passes.
5. **Check & load**: a summary, then **Load to gSender**.

## The preview

- **Depth map**: the picture from above, coloured by the depth each spot will be cut to, with a legend of the levels and how much of the picture each covers. Spots narrower than the bit, which stay higher than the picture asks, show in red.
- **3D toolpath**: gSender's own viewer. Switch it to **Material** to see the terraces cut into a block of stock.

## How it cuts

Passes go from shallow to deep. At each pass depth the bit clears every part of the picture that is at that level or deeper in rings one stepover apart, from the middle of each area outwards, ending on the wall for a clean edge, like Pocket Cutout's spiral but for any shape. The rings are outlines of a distance map, so they are quick to work out. Each ring starts where the last one ended and the bit stays down between them; it lifts only to reach another area. Whatever no ring reached is cleaned up with a few short rows. The bit's centre only goes where the whole bit fits, so it never cuts into a higher level and never leaves the picture's rectangle. Each area is entered with a ramp along its first ring, not a straight plunge.

Only `G0`/`G1` moves are written, so the output runs on GRBL 1.1 and grblHAL.

Work zero: X0 Y0 at the chosen corner of the picture or its centre, Z0 on top of the stock.

## Limits

- The bit is a flat end mill: walls between levels are vertical, not sloped.
- Detail narrower than the bit can't be cut to full depth; use a smaller bit or more smoothing.
- Very busy pictures make long programs. Smoothing and fewer steps keep them shorter.

Always check the preview and air-cut first.

## Clearing strategy: Rings or Adaptive (Experimental)

Under **Bit** you can switch how each level is cleared:

- **Rings** (default): rings one stepover apart from the middle of each area outwards, ending on the wall. The shortest path.
- **Adaptive (Experimental)**: not finished yet, so check the preview and air-cut first. It keeps the load on the bit about even, in smooth arcs and spirals. Picture a ripple spreading from the deepest point of each area: it grows in circles, bends round islands and stops at the walls. The plugin measures how far the ripple travels to every spot (round obstacles, never through them) and cuts that distance's outlines one stepover apart, from the inside out. Neighbouring curves are always one stepover apart, so the bit takes about the same amount all the way, with no full-width cuts and no spikes in inside corners, and each curve is drawn whole, so the path is smooth instead of wobbly. Arcs that end on walls go **Both ways** by default (the bit steps along the wall to the next arc; half the arcs are then conventional, the load is the same) or **Climb only** (every arc climb, the bit travels back after each one: slower). Closed loops step onto the next one diagonally, like a spiral. The walls get one clean pass at the end. In tests, moments of more than twice the target load dropped from about 4–7 % of the path with rings to about 0.5–2 %, and the 99th-percentile load from about 2.7–2.9× to 1.8–2.5× the target. Both ways takes about 10–20 % longer than rings at the same feeds, Climb only up to about 70 % longer. With the even load you can try a smaller stepover with a deeper stepdown or a higher feed. Planning takes about a second for a typical job.
