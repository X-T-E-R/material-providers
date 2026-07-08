import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const packagesDir = path.join(root, "src", "providers", "packages");
const distDir = path.join(root, "dist");
const registryPath = path.join(root, "registry.json");

const MATERIAL_KINDS = new Set([
  "artifact_resolver",
  "artifact_downloader",
  "extractor",
  "converter",
  "enricher",
]);

function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function readManifestVersion(id) {
  const manifestPath = path.join(packagesDir, id, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return { version: manifest.version, kind: manifest.kind };
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const registryById = new Map(registry.providers.map((entry) => [entry.id, entry]));

const packageIds = fs
  .readdirSync(packagesDir)
  .filter((entry) => fs.statSync(path.join(packagesDir, entry)).isDirectory())
  .sort((a, b) => a.localeCompare(b));

const errors = [];

for (const id of packageIds) {
  const manifestInfo = readManifestVersion(id);
  if (!manifestInfo) {
    continue;
  }
  const registryEntry = registryById.get(id);
  if (!registryEntry) {
    errors.push(`${id}: manifest exists but missing from registry.json`);
    continue;
  }
  if (registryEntry.version !== manifestInfo.version) {
    errors.push(
      `${id}: registry.json has ${registryEntry.version} but manifest.json has ${manifestInfo.version}`,
    );
  }
  if (registryEntry.kind !== manifestInfo.kind) {
    errors.push(`${id}: registry kind ${registryEntry.kind} does not match manifest kind ${manifestInfo.kind}`);
  }
  if (!MATERIAL_KINDS.has(registryEntry.kind)) {
    errors.push(`${id}: registry kind is not a material provider kind`);
  }
  if (typeof registryEntry.downloadUrl !== "string" || !/^https:\/\//.test(registryEntry.downloadUrl)) {
    errors.push(`${id}: registry downloadUrl must be an https URL`);
  }
  if (typeof registryEntry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(registryEntry.sha256)) {
    errors.push(`${id}: registry sha256 must be 64 hex chars`);
  }
  if (typeof registryEntry.minCliVersion !== "string" || !/^\d+\.\d+\.\d+/.test(registryEntry.minCliVersion)) {
    errors.push(`${id}: registry minCliVersion must be semver-like`);
  }

  const zipPath = path.join(distDir, `${id}.zip`);
  if (!fs.existsSync(zipPath)) {
    errors.push(`${id}: missing dist archive ${id}.zip (run npm run build)`);
    continue;
  }
  const zipSha = sha256File(zipPath);
  if (zipSha !== registryEntry.sha256.toLowerCase()) {
    errors.push(`${id}: registry sha256 does not match ${id}.zip bytes`);
  }
}

for (const entry of registry.providers) {
  if (!packageIds.includes(entry.id)) {
    errors.push(`${entry.id}: registry entry has no package directory`);
  }
}

if (errors.length > 0) {
  console.error("[verify-registry] validation failed:");
  for (const message of errors) {
    console.error(`  - ${message}`);
  }
  process.exit(1);
}

console.log(`[verify-registry] ok (${registry.providers.length} material providers)`);
