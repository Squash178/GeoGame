# 🌍 GeoGame — Name the Neighbors

A geography quiz: you're given a random country and have to name all of its
land neighbors. The map auto-zooms to the region, dims everything else, and
highlights + labels each neighbor as you find it.

## Play

Just open `index.html` in a browser — no build step, no server, fully offline.

## How it works

- **`data.js`** — borders dataset (ISO-3166 alpha-2 codes → name + neighbor
  codes), generated from the [GeoDataSource country borders](https://github.com/geodatasource/country-borders) list.
- **`map.0.js`–`map.3.js`** — minified world map ([SVG-World-Map](https://github.com/raphaellepuschitz/SVG-World-Map),
  flattened to country level and coordinate-rounded) whose top-level `<g>` ids
  are ISO alpha-2 codes. Shipped as a JS string so the page works from
  `file://` without `fetch`.
- **`game.js`** — game loop, autocomplete, and the dynamic `viewBox` framing
  that clips the map to the target country and its neighbors.

### Gameplay
- 163 playable countries (those with at least one land neighbor).
- Type a country name; the autocomplete does substring matching, so `lux`
  finds Luxembourg and accents/case don't matter.
- Green = found, red = missed (shown after **Give up / Reveal**).
- Score is per round (found / total).

## Regenerating data

`data.js` is generated from the borders CSV; the SVG is fetched from the
source project above. See the commit history for the generation steps.
