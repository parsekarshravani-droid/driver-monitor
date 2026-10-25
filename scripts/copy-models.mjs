
 // Copies face-api model weights from node_modules into public/models.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@vladmandic", "face-api", "model");
const dest = join(root, "public", "models");

const files = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",
];

mkdirSync(dest, { recursive: true });

const missing = files.filter((f) => !existsSync(join(src, f)));

if (missing.length) {
  console.error(`Missing model files in ${src}:\n  ${missing.join("\n  ")}`);
  console.error("Check the installed face-api package and its model directory.");
  process.exit(1);
}

files.forEach((f) => copyFileSync(join(src, f), join(dest, f)));

console.log(`Copied ${files.length} model files to public/models`);
