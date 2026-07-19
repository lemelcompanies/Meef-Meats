// Texas Tropical Plants poster — fal.ai generation script
//
// Usage:
//   FAL_KEY=your-key node generate.js [preset]
//
// Presets:
//   flux-ultra  (default) — best photorealism, no negative prompt support
//   ideogram              — best in-image text/typography rendering
//   recraft               — strong layout + text, "realistic_image" style
//
// Output is saved to ./output/ with a timestamped filename.

import { fal } from "@fal-ai/client";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.FAL_KEY) {
  console.error("Missing FAL_KEY environment variable. Get one at https://fal.ai/dashboard/keys");
  process.exit(1);
}

const prompt = (await readFile(path.join(__dirname, "prompt", "prompt.txt"), "utf8")).trim();
const negativePrompt = (await readFile(path.join(__dirname, "prompt", "negative-prompt.txt"), "utf8")).trim();

// Aspect ratio ~2:3 vertical per the brief; sizes are per-model maximums.
const PRESETS = {
  "flux-ultra": {
    model: "fal-ai/flux-pro/v1.1-ultra",
    input: {
      prompt,
      aspect_ratio: "2:3",
      output_format: "jpeg",
      raw: false, // keep the polished commercial-photography look
    },
  },
  ideogram: {
    model: "fal-ai/ideogram/v2",
    input: {
      prompt,
      negative_prompt: negativePrompt,
      aspect_ratio: "2:3",
      style: "realistic",
      expand_prompt: false, // the brief is already fully specified
    },
  },
  recraft: {
    model: "fal-ai/recraft-v3",
    input: {
      prompt,
      image_size: { width: 1536, height: 2304 },
      style: "realistic_image",
    },
  },
};

const presetName = process.argv[2] ?? "flux-ultra";
const preset = PRESETS[presetName];
if (!preset) {
  console.error(`Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}

console.log(`Generating with ${preset.model} ...`);

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

const image = result.data?.images?.[0] ?? result.data?.image;
if (!image?.url) {
  console.error("No image returned. Full response:");
  console.error(JSON.stringify(result.data, null, 2));
  process.exit(1);
}

const outDir = path.join(__dirname, "output");
await mkdir(outDir, { recursive: true });

const ext = image.content_type?.includes("png") ? "png" : "jpg";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(outDir, `poster-${presetName}-${stamp}.${ext}`);

const res = await fetch(image.url);
if (!res.ok) {
  console.error(`Failed to download image (${res.status}). URL: ${image.url}`);
  process.exit(1);
}
await writeFile(outFile, Buffer.from(await res.arrayBuffer()));

console.log(`Saved: ${outFile}`);
console.log(`Source URL (expires): ${image.url}`);
if (image.width && image.height) console.log(`Dimensions: ${image.width}x${image.height}`);
