# LeanDoc site

A dependency-free static site for GitHub Pages: `index.html`, `styles.css`,
and the files in `assets/`. There is no build step and no script except the
JSON-LD block.

## Preview

```sh
python3 -m http.server 8080 --directory site
```

Then open `http://localhost:8080/`. Serve it over HTTP: the fonts do not load
from a `file:` URL.

## Validate

```sh
node site/validate.mjs
```

It checks the page structure, same-page and local links, assets and image
sizes, alt text, that no outside script or style is loaded, the writing
rules, the version against `package.json`, and every release asset name
against `.github/workflows/build.yml`. It does not replace a look in a
browser at desktop, tablet, and phone widths.

## Images

- `assets/leandoc-window.png` and `assets/leandoc-fidelity-bar.png` are real
  captures of the Linux build, the same files as `docs/images/leandoc-linux-*.png`.
  `docs/images/screenshot-source/` holds the documents, the generator, and
  `capture.sh` that made them. Never replace them with a drawn mock-up.
- `assets/social-preview.png` (1280x640) is rendered from
  `docs/images/screenshot-source/social-preview.html` by
  `make-social-preview.mjs`.
- `assets/leandoc-icon.svg` and `.png` are copies of `brand/`.
- `assets/fonts/` holds IBM Plex WOFF2 files copied from the pinned
  `@fontsource` packages (OFL-1.1, see `THIRD_PARTY_NOTICES.md`).

## On a new release

Change the version and asset links in `index.html` (the release line, the
download buttons, the platform table, and the JSON-LD), and the package size
in the facts strip if it was measured again. `node site/validate.mjs` and
`node scripts/Test-ReleaseEngineering.mjs` fail until they match
`package.json`.
