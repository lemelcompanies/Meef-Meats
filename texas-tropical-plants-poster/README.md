# Texas Tropical Plants — Advertising Poster (fal.ai)

Luxury, ultra-photorealistic vertical (2:3) commercial advertising poster for
**Texas Tropical Plants**, generated with fal.ai. The hero feature is a
72" x 96" floor-to-ceiling living plant wall in an upscale office interior,
styled like a real high-end interior design print ad.

## Quick start

```bash
npm install
cp .env.example .env    # add your FAL_KEY (https://fal.ai/dashboard/keys)
FAL_KEY=your-key npm run generate
```

The image is saved to `output/`.

## Presets

| Command | Model | Best for |
|---|---|---|
| `npm run generate` | `fal-ai/flux-pro/v1.1-ultra` | Photorealism (recommended for the living wall) |
| `npm run generate:ideogram` | `fal-ai/ideogram/v2` | In-image text/typography accuracy |
| `npm run generate:recraft` | `fal-ai/recraft-v3` | Layout + text balance |

Notes:

- **Flux Ultra** produces the most believable living wall but does not accept a
  negative prompt (the avoid-list is baked into the main prompt as "no ..."
  phrasing). It renders text well but long copy blocks may need retries.
- **Ideogram / Recraft** are the strongest at rendering the exact brand copy
  (headline, banner, contact info) but slightly less photoreal.
- For true print quality, a common workflow is: generate the *scene only* with
  Flux Ultra, then set the typography, banner, and contact block in a design
  tool (Canva/Figma/Illustrator) on top. That guarantees pixel-perfect brand
  text at 4K.
- To reach full 4K, upscale the result with `fal-ai/clarity-upscaler` or
  fal's ESRGAN endpoints.

## Editing the brief

- `prompt/prompt.txt` — the full main prompt. The living wall dimensions are
  set to **72" x 96"**; edit that line if your installed wall differs.
- `prompt/negative-prompt.txt` — the avoid-list (used by models that support
  negative prompts).

## Suggested settings (from the brief)

- Aspect ratio: vertical 2:3
- Resolution: highest available, upscale to 4K
- Guidance / prompt strength: medium-high
- Style: photorealistic / commercial photography
- Negative prompt strength: medium-high (where supported)
