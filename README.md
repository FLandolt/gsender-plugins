# Plugins for gSender

Small, free plugins for [gSender](https://github.com/Sienci-Labs/gsender) that turn a few numbers into clean, GRBL-safe G-code, with a live 3D preview. No CAM software needed.

**Website and live demos: <https://flandolt.github.io/gsender-plugins/>**

> **Always check before you cut.** Look at the toolpath preview, run the job in the air first, and keep a hand on the stop button. You use these plugins at your own risk.

## Plugins

| Plugin | What it does | Docs |
|---|---|---|
| **Hole Pattern** | Cuts one hole or a grid of holes. The bit spirals down level by level, with arcs or short chords. | [plugins/hole-pattern](plugins/hole-pattern) |
| **Cutout** | Cuts a rectangle or a circle inside or outside the line, with sharp or rounded corners and holding tabs. Zero at the centre or any corner. | [plugins/cutout](plugins/cutout) |
| **Pocket Cutout** | Clears a rectangular or round pocket. The bit spirals down (no plunging), then clears in a spiral from the middle outwards, clockwise or counter-clockwise, with smooth lane changes between rings. Zero at the centre or any corner. | [plugins/pocket-cutout](plugins/pocket-cutout) |
| **V-Carve** | Carves text, SVG shapes and pictures with a V-bit: deeper where the shape is wide, with sharp points at the corners. Refuses unsafe settings and says why. | [plugins/vcarve](plugins/vcarve) |
| **Surfacing** | Faces a rectangular area. Choose the start corner and direction, how passes turn (outside or inside the material) whether they run back and forth or all the same way, and where to zero (any corner or the centre). | [plugins/surfacing](plugins/surfacing) |

All plugins:

- Write `G0`/`G1` moves and, where the shape has circles or rounded corners, by default `G2`/`G3` arcs (V-Carve writes straight moves only) (smaller files, smoother motion). Pick **Lines (G1)** under *More options* to get short `G1` chords instead. No canned cycles and no cutter compensation, so the output runs on GRBL 1.1 and grblHAL.
- Show a 3D toolpath preview using gSender's own viewer, with the bit drawn at your tool diameter. Switch the preview to **Material** to run the viewer's cut simulation and see what is left of a block of stock, so any uncut area stands out.
- Keep problems and warnings in a strip above the buttons, so they stay visible however far you scroll the settings.
- Offer **Slow**, **Medium** and **High** speed presets, or your own feed, plunge, spindle and stepdown values.
- Work in millimetres or inches.
- Load the program straight into gSender with **Load to gSender**.

You can try both in your browser on the [website](https://flandolt.github.io/gsender-plugins/). In the demo, **Load to gSender** downloads the `.nc` file instead.

## Install

Requires gSender 1.6.0 or newer.

1. Download the zip of the plugin you want from the [Releases](https://github.com/FLandolt/gsender-plugins/releases) page. Leave it zipped.
2. In gSender, install a plugin and select the downloaded zip. gSender unpacks it for you.
3. Open the plugin from the tools page.

If you prefer, you can unzip it into gSender's `plugins` folder yourself, so you end up with `plugins/<name>/gsender-plugin.json`.

## Develop

Needs [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install                                      # once, at the repo root
npm run dev --workspace plugins/cutout      # run one plugin standalone, with a mocked gSender
npm test                                         # unit tests for all plugins
npm run check                                    # type-check all plugins
npm run build                                    # build all plugins to plugins/*/ui
```

Outside gSender the plugins talk to a small mock bridge ([`packages/shared/src/mockBridge.ts`](packages/shared/src/mockBridge.ts)), so you can work on them in a plain browser.

### Layout

```
plugins/<name>/     one gSender plugin each: its own manifest, source and build (ui/)
packages/shared/    code shared by the plugins: mock bridge, UI parts, 3D preview, G-code helpers
site/               the GitHub Pages website (plain HTML, no build step)
```

The website's live demos are built from the plugin sources by the [Pages workflow](.github/workflows/pages.yml) on every push to `main`.

## Releasing

Tag a plugin to build it and publish its zip as a GitHub release:

```bash
git tag cutout-v0.1.0
git push --tags
```

The [release workflow](.github/workflows/release.yml) takes the plugin name and version from the tag, builds it, and attaches `<plugin>-<version>.zip` to the release. The website's download buttons pick up the newest release automatically.

## How this was made

These plugins were vibe-coded: written with heavy help from an AI coding assistant ([Claude](https://claude.com/claude-code)), directed and tested by me. The generators have unit tests (including arcs versus chords producing the same path), but that is no substitute for checking the toolpath yourself. Read the preview, air-cut first, and please [report anything odd](https://github.com/FLandolt/gsender-plugins/issues).

## Credits

Made for [gSender](https://sienci.com/gsender/), the free CNC software by [Sienci Labs](https://sienci.com/), and built on the [gSender Plugin SDK](https://github.com/Sienci-Labs/gsender/blob/dev/packages/plugin-sdk/README.md). Big thanks to the Sienci team. This project is not affiliated with Sienci Labs.

## Support

Found a bug or want a feature? [Open an issue](https://github.com/FLandolt/gsender-plugins/issues).

If a plugin saved you time, you can [buy me a coffee](https://buymeacoffee.com/flandolt).
