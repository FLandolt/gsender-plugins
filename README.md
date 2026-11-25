<div align="center">

<a href="https://flandolt.github.io/gsender-plugins/"><picture>
<source media="(prefers-color-scheme: dark)" srcset=".github/readme/logo-dark.svg">
<img alt="" src=".github/readme/logo-light.svg" width="72" height="72">
</picture></a>

# Plugins for gSender

**Source code of the [gSender](https://github.com/Sienci-Labs/gsender) plugins that turn a few numbers into clean, GRBL-safe G-code.**

<a href="https://flandolt.github.io/gsender-plugins/"><img alt="Plugins, live demos and downloads on the website" src="https://img.shields.io/badge/Plugins%2C_demos_and_downloads-open_the_website-0070f3?style=for-the-badge"></a>

<a href="https://github.com/FLandolt/gsender-plugins/releases"><img alt="Releases" src="https://img.shields.io/badge/releases-GitHub-0a0a0a"></a>
<a href="https://github.com/FLandolt/gsender-plugins/actions/workflows/pages.yml"><img alt="Website deploy" src="https://img.shields.io/github/actions/workflow/status/FLandolt/gsender-plugins/pages.yml?label=website"></a>
<a href="https://github.com/FLandolt/gsender-plugins/actions/workflows/auto-release.yml"><img alt="Auto release" src="https://img.shields.io/github/actions/workflow/status/FLandolt/gsender-plugins/auto-release.yml?label=auto-release"></a>
<a href="https://github.com/Sienci-Labs/gsender"><img alt="gSender 1.6.0 or newer" src="https://img.shields.io/badge/gSender-%E2%89%A5%201.6.0-d4602a"></a>
<a href="https://nodejs.org/"><img alt="Node.js 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A5%2020-339933?logo=nodedotjs&logoColor=white"></a>
<a href="https://github.com/FLandolt/gsender-plugins/issues"><img alt="Open issues" src="https://img.shields.io/github/issues/FLandolt/gsender-plugins?label=issues"></a>
<a href="https://claude.com/claude-code"><img alt="Made with Claude Code" src="https://img.shields.io/badge/made_with-Claude_Code-d4602a"></a>

[Layout](#repository-layout) · [Develop](#develop) · [How a plugin is built](#how-a-plugin-is-built) · [Design system](#design-system) · [Add a plugin](#add-a-plugin) · [Releasing](#releasing)

</div>

> [!NOTE]
> What the plugins do, the live demos, the downloads and the install steps are on the **[website](https://flandolt.github.io/gsender-plugins/)**. This README is for people working on the code.

> [!WARNING]
> Always check before you cut: read the toolpath preview, air-cut first, and keep a hand on the stop button. You use these plugins at your own risk.

## Repository layout

```
plugins/<name>/     one gSender plugin each: manifest, source, tests and its own build (ui/)
packages/shared/    code every plugin uses: layout, UI parts, theme, 3D preview, G-code helpers, mock bridge
site/               the GitHub Pages website (plain HTML, no build step)
.github/workflows/  Pages deploy, auto-release, tag release
.github/readme/     images used by this README
```

npm workspaces cover `plugins/*`. `packages/shared` is not a package: plugins import it through the `@shared` path alias (set in each plugin's `vite.config.ts` and `tsconfig.json`).

| Plugin | Folder (and id) | Docs |
|---|---|---|
| Hole Pattern | `plugins/hole-pattern` | [README](plugins/hole-pattern) |
| Cutout | `plugins/cutout` | [README](plugins/cutout) |
| Pocket Cutout | `plugins/pocket-cutout` | [README](plugins/pocket-cutout) |
| V-Carve | `plugins/vcarve` | [README](plugins/vcarve) |
| Surfacing | `plugins/surfacing` | [README](plugins/surfacing) |
| Height Map | `plugins/heightmap` | [README](plugins/heightmap) |

## Develop

Needs [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install                                  # once, at the repo root
npm run dev --workspace plugins/heightmap    # one plugin in the browser, with a mocked gSender
npm test                                     # unit tests of every plugin (Vitest)
npm run check                                # type-check every plugin (tsc --noEmit)
npm run build                                # build every plugin into plugins/*/ui
npm run build:demo --workspace plugins/heightmap   # the website demo build (ui-demo/)
```

Outside gSender there is no host to answer the SDK, so the plugins talk to a small mock bridge ([`mockBridge.ts`](packages/shared/src/mockBridge.ts)). It speaks the real bridge protocol back to the unmodified SDK, so the harness runs the same code as production. In that harness **Load to gSender** downloads the `.nc` file instead.

## How a plugin is built

```
plugins/<name>/
  gsender-plugin.json   id, name, version, permissions, the slot it appears in, allowed SDK calls
  package.json          scripts (dev, build, build:demo, check, test) and dependencies
  src/
    App.tsx             state, steps and wiring; renders the shared PluginLayout
    lib/params.ts       the settings type, defaults, and check() (errors and warnings)
    lib/generate.ts     params -> G-code
    lib/*.test.ts       unit tests
  vite.config.ts        builds to ui/ (or ui-demo/ in demo mode, which bundles React and the SDK)
```

- **Units:** lengths are millimetres everywhere. Conversion to the display units happens at the UI boundary and in the G-code emitter.
- **G-code:** `G0`/`G1`, plus `G2`/`G3` arcs where the shape has circles or rounded corners (a *Lines (G1)* option writes chords instead). No canned cycles, no cutter compensation, so the output runs on GRBL 1.1 and grblHAL.
- **Validation:** nothing is generated or loaded while a box is empty (`NaN`) or a needed value is 0; `check()` returns what is wrong in plain words and the UI shows it.

### The shared frame

`PluginLayout` ([`packages/shared/src/PluginLayout.tsx`](packages/shared/src/PluginLayout.tsx)) is the one screen every plugin uses. A plugin hands it a list of steps and a few nodes:

```tsx
<PluginLayout
  title="Height Map"
  intro="Carves a picture into stepped levels. Z0 = top of stock."
  steps={steps}          // { id, label, hint?, issue?, content }[]  -> tabs in the left panel
  preview={<DepthMap … />}   // the live visualisation, right panel
  stats={<StatRow items={[["Size", "100 × 75 mm"], …]} />}
  notices={<Notices errors={…} warnings={…} />}   // floats over the preview
  code={gcode}           // enables the G-code button
  actions={<button className={primaryBtn}>Load to gSender</button>}
  status={status}        // result of the last load
/>
```

The two panels keep their size whatever the step, so nothing jumps. Landscape screens put them side by side; portrait (9:16) and narrow screens stack settings over preview. Form controls live in [`ui.tsx`](packages/shared/src/ui.tsx): `NumberField` (round − / + buttons, unit in the label, step defaults to a size that scales with the value, override with `step`), `Stepper`, `Segmented`, `OnOff`, `Toggle`, `SliderField`, `SpeedPresets`, `FilePicker`, `More`, `Summary`, `Notices`. Drawings (bit in its cut, stepover, tabs) are in [`diagrams.tsx`](packages/shared/src/diagrams.tsx); the picture, mask, distance-transform and clearing code that several plugins share is in `picture.ts`, `clearing.ts` and `wavefront.ts`.

## Design system

One file, [`packages/shared/src/theme.css`](packages/shared/src/theme.css), is imported by every plugin's `index.css` after Tailwind (v4). It redefines Tailwind's `gray`, `slate` and `blue` scales, so the ordinary utility classes pick up the look:

- **Light** uses `gray-*` (warm neutrals; `gray-50` is the window, `white` the panels, `paper` the raised fields). **Dark** uses `slate-*` (`slate-950` window, `900` panels, `800` fields). gSender puts `html.dark` on the iframe, so dark mode is keyed off that class, not `prefers-color-scheme`.
- **Accent:** one muted industrial orange. It sits in the `blue-*` scale (the name is kept so existing classes work): `blue-600` light, `blue-500` dark. Use it for the main action, focus and selection only.
- **One control height:** `--ctl` (3 rem = 48 px, six steps of the 8 px grid, above the 44 pt touch minimum) for inputs, buttons, segmented controls and tabs. Spacing is in multiples of 8.
- **Type:** system font first (SF Pro on Apple), IBM Plex / JetBrains Mono for numbers.
- `wide:` is a custom variant: landscape and at least 720 px wide.

## Add a plugin

1. Copy a plugin folder (`plugins/hole-pattern` is the smallest) and change the `id`, `name` and route in `gsender-plugin.json`, and the name in `package.json`.
2. Write `lib/params.ts`, `lib/generate.ts` and tests, then the steps in `App.tsx`.
3. Add the id to the demo loop in [`pages.yml`](.github/workflows/pages.yml) and a card (name, blurb, drawing) to `PLUGINS` and `ART` in [`site/index.html`](site/index.html).
4. Add a `plugins/<name>/README.md`, and a row in the table above.

## Releasing

Releases are automatic. On every push to `main` the [auto-release workflow](.github/workflows/auto-release.yml) looks at each plugin:

- If its code changed since its newest tag, it gets the next patch version (`cutout-v0.0.2` → `cutout-v0.0.3`): the plugin is tested, built and published as `<plugin>-<version>.zip` on a new GitHub release with that tag. The version in `package.json` and `gsender-plugin.json` is overwritten with the tag's version at build time.
- If its newest tag has no release yet, that tag is released.
- Otherwise nothing happens. Changes to `packages/shared` or `package-lock.json` count for every plugin; README edits don't.

The website's download buttons pick up the newest release automatically. To catch up by hand, open the workflow in the Actions tab and press **Run workflow**.

For a bigger version jump, tag it yourself, one tag per push (GitHub ignores tag pushes of more than three tags at once):

```bash
git tag cutout-v0.1.0
git push origin cutout-v0.1.0
```

The [release workflow](.github/workflows/release.yml) builds that tag, and later automatic releases count on from it.

The [Pages workflow](.github/workflows/pages.yml) builds every plugin's demo from source and deploys `site/` on each push to `main` that touches the site, plugins, shared code or lockfile.

## How this was made

These plugins were vibe-coded: written with heavy help from an AI coding assistant ([Claude](https://claude.com/claude-code)), directed and tested by me. The generators have unit tests (including arcs versus chords producing the same path), but that is no substitute for checking the toolpath yourself. Read the preview, air-cut first, and please [report anything odd](https://github.com/FLandolt/gsender-plugins/issues).

## Credits

Made for [gSender](https://sienci.com/gsender/), the free CNC software by [Sienci Labs](https://sienci.com/), and built on the [gSender Plugin SDK](https://github.com/Sienci-Labs/gsender/blob/dev/packages/plugin-sdk/README.md). Big thanks to the Sienci team. This project is not affiliated with Sienci Labs.

## Support

Found a bug or want a feature? [Open an issue](https://github.com/FLandolt/gsender-plugins/issues).
