import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distDir = path.join(root, "dist");
const registryPath = path.join(root, "registry.json");
const mutableTag = "material-registry-latest";

if (!fs.existsSync(registryPath) || !fs.existsSync(distDir)) {
  throw new Error("Missing generated release files; run npm run build first");
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const immutableTags = new Set();
for (const entry of registry.providers ?? []) {
  const match = String(entry.downloadUrl).match(/\/releases\/download\/([^/]+)\/([^/]+\.zip)$/);
  if (!match) throw new Error(`${entry.id}: downloadUrl is not a GitHub release asset URL`);
  if (match[1] === mutableTag) {
    throw new Error(`${entry.id}: archive URL points at mutable registry tag`);
  }
  immutableTags.add(match[1]);
}
if (immutableTags.size !== 1) {
  throw new Error(`Expected one immutable archive tag, got ${[...immutableTags].join(", ")}`);
}

const immutableZipAssets = fs
  .readdirSync(distDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
  .map((entry) => `dist/${entry.name}`)
  .sort((left, right) => left.localeCompare(right));
if (immutableZipAssets.length !== registry.providers.length) {
  throw new Error("Immutable asset count differs from registry provider count");
}
const immutableAssets = [...immutableZipAssets, "registry.json"].sort(
  (left, right) => left.localeCompare(right),
);

const plan = {
  publishOrder: ["immutableRelease", "mutableRegistry"],
  immutableRelease: {
    tag: [...immutableTags][0],
    assets: immutableAssets,
    clobber: false,
    exactAssets: true,
  },
  mutableRegistry: {
    tag: mutableTag,
    assets: ["registry.json"],
    clobber: true,
    exactAssets: true,
  },
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(`[release-plan] immutable tag: ${plan.immutableRelease.tag}`);
  console.log(`[release-plan] immutable exact assets: ${plan.immutableRelease.assets.join(", ")}`);
  console.log(`[release-plan] mutable pointer: ${mutableTag}/registry.json only`);
  console.log("[release-plan] dry-run only; no network or release mutation performed");
}
