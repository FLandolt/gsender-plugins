# gSender plugins

A small collection of [gSender](https://github.com/Sienci-Labs/gsender) plugins
that generate GRBL-compliant G-code (`G0`/`G1` only).

| Plugin | What it does |
|---|---|
| [`hole-pattern`](plugins/hole-pattern) | Grid of round holes, spiralling down level by level |
| [`rect-cutout`](plugins/rect-cutout) | Rectangular cut-out with adjustable corner radius and holding tabs |

Website: <https://flandolt.github.io/gsender-plugins/> (source in [`site/`](site)).

## Layout

```
plugins/<name>/     one gSender plugin each (own manifest, own build → ui/)
site/               the GitHub Pages website (plain HTML, no build)
packages/shared/    code used by several plugins (mock bridge, UI parts, 3D preview)
```

## Working on it

```bash
npm install            # once, at the repo root
npm run dev --workspace plugins/rect-cutout     # standalone with mocked gSender
npm test               # all plugins
npm run build          # all plugins → plugins/*/ui
```

## Releasing

Tag a plugin to build and publish its zip as a GitHub release asset:

```bash
git tag rect-cutout-v0.1.0 && git push --tags
```
