# Height Map

A [gSender](https://github.com/Sienci-Labs/gsender) plugin that carves a picture into stepped levels, like a contour model or a terraced relief map.

Load any picture (colour works too: it is turned to black and white), set how deep the deepest level goes and how many steps down you want. **2 steps give three levels: top, middle and bottom.** The darkest parts of the picture go deepest and the lightest stay at the top of the stock; switch on **Invert** to swap that. A satellite or GIS height map, where light means high, works as it is.

## Settings

1. **Picture**: choose the file, invert it if needed, and set its real size by width or height (the other side follows). **Smoothing** blurs the picture a little first, so noise and specks don't turn into tiny cuts. Pick where X0 Y0 is.
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
