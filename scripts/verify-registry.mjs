import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const packagesDir = path.join(root, "src", "providers", "packages");
const distDir = process.env.PROVIDER_DIST_DIR
  ? path.resolve(process.env.PROVIDER_DIST_DIR)
  : path.join(root, "dist");
const registryPath = process.env.PROVIDER_REGISTRY_PATH
  ? path.resolve(process.env.PROVIDER_REGISTRY_PATH)
  : path.join(root, "registry.json");
const mutableRegistryTag = "material-registry-latest";
const materialKinds = new Set([
  "artifact_resolver",
  "artifact_downloader",
  "extractor",
  "converter",
  "enricher",
]);
const registryEntryFields = [
  "downloadUrl",
  "id",
  "kind",
  "minCliVersion",
  "sha256",
  "version",
];
const expectedArchiveFiles = ["manifest.json", "provider.js"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameArray(left, right) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function providerEntryPath(id) {
  const packageDir = path.join(packagesDir, id);
  const entryTs = path.join(packageDir, "index.ts");
  const entryJs = path.join(packageDir, "provider.js");
  if (fs.existsSync(entryTs)) return entryTs;
  if (fs.existsSync(entryJs)) return entryJs;
  return null;
}

if (!fs.existsSync(registryPath)) {
  throw new Error(`Missing generated registry: ${registryPath}; run npm run build first`);
}
if (!fs.existsSync(distDir)) {
  throw new Error(`Missing generated provider directory: ${distDir}; run npm run build first`);
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
if (!Array.isArray(registry.providers)) {
  throw new Error("registry.json providers must be an array");
}

const packageIds = fs
  .readdirSync(packagesDir)
  .filter((entry) => fs.statSync(path.join(packagesDir, entry)).isDirectory())
  .sort((left, right) => left.localeCompare(right));
const registryIds = registry.providers
  .map((entry) => entry.id)
  .sort((left, right) => left.localeCompare(right));
const errors = [];

if (!sameArray(registryIds, packageIds)) {
  errors.push(
    `registry ids differ from package ids: expected ${packageIds.join(", ")}; got ${registryIds.join(", ")}`,
  );
}
if (new Set(registryIds).size !== registryIds.length) {
  errors.push("registry.json contains duplicate provider ids");
}

for (const id of packageIds) {
  const packageDir = path.join(packagesDir, id);
  const manifestPath = path.join(packageDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push(`${id}: missing manifest.json`);
    continue;
  }
  if (!providerEntryPath(id)) {
    errors.push(`${id}: missing index.ts or provider.js`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== id) {
    errors.push(`${id}: manifest id is ${String(manifest.id)}`);
  }

  const registryEntry = registry.providers.find((entry) => entry.id === id);
  if (!registryEntry) continue;
  const actualFields = Object.keys(registryEntry).sort((left, right) =>
    left.localeCompare(right),
  );
  if (!sameArray(actualFields, registryEntryFields)) {
    errors.push(
      `${id}: registry fields must be exactly ${registryEntryFields.join(", ")}; got ${actualFields.join(", ")}`,
    );
  }
  if (registryEntry.version !== manifest.version) {
    errors.push(
      `${id}: registry version ${registryEntry.version} != manifest ${manifest.version}`,
    );
  }
  if (registryEntry.kind !== manifest.kind) {
    errors.push(
      `${id}: registry kind ${registryEntry.kind} != manifest ${manifest.kind}`,
    );
  }
  if (!materialKinds.has(registryEntry.kind)) {
    errors.push(`${id}: registry kind is not a material provider subtype`);
  }
  const expectedMinCliVersion = manifest.minCliVersion || "0.1.0";
  if (registryEntry.minCliVersion !== expectedMinCliVersion) {
    errors.push(`${id}: registry minimum CLI version differs from manifest`);
  }
  if (
    typeof registryEntry.minCliVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(registryEntry.minCliVersion)
  ) {
    errors.push(`${id}: registry minCliVersion must be semver-like`);
  }
  if (
    typeof registryEntry.downloadUrl !== "string" ||
    !/^https:\/\//.test(registryEntry.downloadUrl)
  ) {
    errors.push(`${id}: registry downloadUrl must be an HTTPS URL`);
  } else {
    if (!registryEntry.downloadUrl.endsWith(`/${id}.zip`)) {
      errors.push(`${id}: downloadUrl does not end with /${id}.zip`);
    }
    if (
      registryEntry.downloadUrl.includes(`/releases/download/${mutableRegistryTag}/`) ||
      registryEntry.downloadUrl.includes("/releases/latest/download/")
    ) {
      errors.push(`${id}: downloadUrl points at a mutable release`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(String(registryEntry.sha256 ?? ""))) {
    errors.push(`${id}: registry sha256 is missing or invalid`);
  }

  const zipPath = path.join(distDir, `${id}.zip`);
  if (!fs.existsSync(zipPath)) {
    errors.push(`${id}: generated ZIP missing`);
    continue;
  }
  const zipBytes = fs.readFileSync(zipPath);
  if (sha256(zipBytes) !== registryEntry.sha256) {
    errors.push(`${id}: generated ZIP sha256 differs from registry`);
  }
  const archive = await JSZip.loadAsync(zipBytes);
  const archiveFiles = Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name);
  if (!sameArray(archiveFiles, expectedArchiveFiles)) {
    errors.push(
      `${id}: ZIP entries/order must be ${expectedArchiveFiles.join(", ")}; got ${archiveFiles.join(", ")}`,
    );
    continue;
  }

  const bundleDir = path.join(distDir, id);
  const generatedPackageFiles = fs
    .readdirSync(bundleDir, { withFileTypes: true })
    .map((entry) => (entry.isFile() ? entry.name : `${entry.name}/`))
    .sort((left, right) => left.localeCompare(right));
  if (!sameArray(generatedPackageFiles, expectedArchiveFiles)) {
    errors.push(
      `${id}: generated package files must be ${expectedArchiveFiles.join(", ")}; got ${generatedPackageFiles.join(", ")}`,
    );
  }
  const archivedManifest = JSON.parse(
    await archive.file("manifest.json").async("string"),
  );
  const providerCode = await archive.file("provider.js").async("string");
  for (const filename of expectedArchiveFiles) {
    const archivedFile = archive.file(filename);
    if (archivedFile.date.toISOString() !== "1980-01-01T00:00:00.000Z") {
      errors.push(`${id}: ${filename} ZIP timestamp is not the fixed UTC epoch`);
    }
    if ((archivedFile.unixPermissions & 0o777) !== 0o644) {
      errors.push(`${id}: ${filename} ZIP mode is not 0644`);
    }
    const distBytes = fs.readFileSync(path.join(distDir, id, filename));
    const archiveBytes = await archivedFile.async("nodebuffer");
    if (!archiveBytes.equals(distBytes)) {
      errors.push(`${id}: ZIP ${filename} differs from dist/${id}/${filename}`);
    }
  }
  if (
    archivedManifest.id !== registryEntry.id ||
    archivedManifest.version !== registryEntry.version ||
    archivedManifest.kind !== registryEntry.kind
  ) {
    errors.push(`${id}: ZIP manifest identity differs from registry`);
  }
  if (archivedManifest.integrity?.sha256 !== sha256(Buffer.from(providerCode, "utf8"))) {
    errors.push(`${id}: ZIP manifest integrity differs from provider.js`);
  }
  if (!providerCode.includes("globalThis.__material_provider_exports")) {
    errors.push(`${id}: provider.js lacks the material compatibility export`);
  }
}

const generatedTopLevelEntries = fs
  .readdirSync(distDir, { withFileTypes: true })
  .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
  .sort((left, right) => left.localeCompare(right));
const expectedTopLevelEntries = packageIds
  .flatMap((id) => [`${id}/`, `${id}.zip`])
  .sort((left, right) => left.localeCompare(right));
if (!sameArray(generatedTopLevelEntries, expectedTopLevelEntries)) {
  errors.push(
    `dist entries differ: expected ${expectedTopLevelEntries.join(", ")}; got ${generatedTopLevelEntries.join(", ")}`,
  );
}

for (const entry of registry.providers) {
  if (!packageIds.includes(entry.id)) {
    errors.push(`${entry.id}: registry entry has no package directory`);
  }
}

if (errors.length > 0) {
  console.error("[verify-registry] release verification failed:");
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(
  `[verify-registry] ok (${registry.providers.length} material providers with immutable archive URLs)`,
);
