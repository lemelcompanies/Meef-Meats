// Upscale a generated poster to 4K+ via fal.ai
//
// Usage:
//   FAL_KEY=your-key node upscale.js [preset] [image]
//
// Presets:
//   crisp   (default) — ESRGAN 2x: faithful upscale, keeps typography pixel-exact
//   detail            — Clarity upscaler 2x: re-adds photographic micro-detail
//                       (leaves, fabric, wood grain); check the text afterwards,
//                       diffusion upscalers can occasionally nudge letterforms
//
// [image] can be a local file path or an https URL. If omitted, the newest
// image in ./output/ is used.

import { fal } from "@fal-ai/client";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "output");

if (!process.env.FAL_KEY) {
  console.error("Missing FAL_KEY environment variable. Get one at https://fal.ai/dashboard/keys");
  process.exit(1);
}

const presetName = process.argv[2] ?? "crisp";
let source = process.argv[3];

if (!source) {
  const entries = await readdir(outDir).catch(() => []);
  const images = entries.filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !f.includes("-4k"));
  if (images.length === 0) {
    console.error("No image found in ./output/ — run `npm run generate` first, or pass a file path/URL.");
    process.exit(1);
  }
  const stats = await Promise.all(
    images.map(async (f) => ({ f, mtime: (await stat(path.join(outDir, f))).mtimeMs }))
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  source = path.join(outDir, stats[0].f);
}

let imageUrl;
if (/^https?:\/\//i.test(source)) {
  imageUrl = source;
} else {
  console.log(`Uploading ${source} ...`);
  const buf = await readFile(source);
  const type = source.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  imageUrl = await fal.storage.upload(new Blob([buf], { type }));
}

const PRESETS = {
  crisp: {
    model: "fal-ai/esrgan",
    input: { image_url: imageUrl, scale: 2 },
  },
  detail: {
    model: "fal-ai/clarity-upscaler",
    input: {
      image_url: imageUrl,
      upscale_factor: 2,
      creativity: 0.2, // low: add texture without redrawing the design
      resemblance: 0.85, // high: stay faithful to the original composition
      prompt:
        "ultra photorealistic commercial interior photography, dense living plant wall with fine leaf detail, crisp clean typography, premium print advertisement, sharp focus, high dynamic range",
    },
  },
};

const preset = PRESETS[presetName];
if (!preset) {
  console.error(`Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}

console.log(`Upscaling with ${preset.model} ...`);

const result = await fal.subscribe(preset.model, {
  input: preset.input,
  logs: true,
  onQueueUpdate(update) {
    if (update.status === "IN_PROGRESS") {
      for (const log of update.logs ?? []) console.log(log.message);
    } else {
      console.log(`Status: ${update.status}`);
    }
  },
});

const image = result.data?.image ?? result.data?.images?.[0];
if (!image?.url) {
  console.error("No image returned. Full response:");
  console.error(JSON.stringify(result.data, null, 2));
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const ext = image.content_type?.includes("png") ? "png" : "jpg";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(outDir, `poster-4k-${presetName}-${stamp}.${ext}`);

const res = await fetch(image.url);
if (!res.ok) {
  console.error(`Failed to download image (${res.status}). URL: ${image.url}`);
  process.exit(1);
}
await writeFile(outFile, Buffer.from(await res.arrayBuffer()));

console.log(`Saved: ${outFile}`);
if (image.width && image.height) console.log(`Dimensions: ${image.width}x${image.height}`);
