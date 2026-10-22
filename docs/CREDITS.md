# Credits

Third-party assets shipped with this module, with their licenses.

## Textures

The tiles under `assets/textures/` are derived from [ambientCG](https://ambientcg.com) materials,
released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (public
domain, no attribution required). The leather was re-rendered from the 1K JPG maps, mixing the
displacement and roughness maps into a neutral grain that the stylesheet tints. The metal tiles
come from each material's 1K colour map, in greyscale and re-centred on mid grey, so the stylesheet
overlays them on its own lighting: converted to greyscale, resized to 256×256 (Lanczos), each pixel
remapped to `128 + (v − mean) × 34 / stddev` clamped to 0–255, and saved as WebP at quality 82.

| File | Source material | License |
| --- | --- | --- |
| `assets/textures/leather-grain.webp` | [Leather037](https://ambientcg.com/view?id=Leather037) | CC0 1.0 |
| `assets/textures/metal-iron.webp` | [Metal054A](https://ambientcg.com/view?id=Metal054A) | CC0 1.0 |
| `assets/textures/metal-steel.webp` | [Metal009](https://ambientcg.com/view?id=Metal009) | CC0 1.0 |
| `assets/textures/metal-bronze.webp` | [Metal008](https://ambientcg.com/view?id=Metal008) | CC0 1.0 |
| `assets/textures/metal-brass.webp` | [Metal048B](https://ambientcg.com/view?id=Metal048B) | CC0 1.0 |
| `assets/textures/metal-gold.webp` | [Metal042A](https://ambientcg.com/view?id=Metal042A) | CC0 1.0 |
