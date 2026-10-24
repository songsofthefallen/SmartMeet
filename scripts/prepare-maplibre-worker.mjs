import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const maplibreDist = join(projectRoot, "node_modules", "maplibre-gl", "dist");
const publicDirectory = join(projectRoot, "public");

await mkdir(publicDirectory, { recursive: true });
await Promise.all([
  copyFile(join(maplibreDist, "maplibre-gl-worker.mjs"), join(publicDirectory, "maplibre-gl-worker.mjs")),
  copyFile(join(maplibreDist, "maplibre-gl-shared.mjs"), join(publicDirectory, "maplibre-gl-shared.mjs")),
]);
