import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const buildScript = path.join(__dirname, "build-providers.mjs");
const verifyScript = path.join(__dirname, "verify-registry.mjs");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "material-retained-registry-"));
const simulatedReleases = path.join(tempRoot, "releases");
const repoUrl = "https://github.com/example/material-providers";
const oldTag = "material-providers-retained-old-fixture";
const newTag = "material-providers-new-fixture";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function buildRelease(tag) {
  const outputRoot = path.join(tempRoot, tag);
  const dist = path.join(outputRoot, "dist");
  const registryPath = path.join(outputRoot, "registry.json");
  const result = spawnSync(process.execPath, [buildScript], {
    cwd: root,
    env: {
      ...process.env,
      PROVIDER_REPO_URL: repoUrl,
      PROVIDER_RELEASE_TAG: tag,
      PROVIDER_DIST_DIR: dist,
      PROVIDER_REGISTRY_PATH: registryPath,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Fixture build ${tag} failed:\n${result.stdout}\n${result.stderr}`);
  }
  const verification = spawnSync(process.execPath, [verifyScript], {
    cwd: root,
    env: {
      ...process.env,
      PROVIDER_REPO_URL: repoUrl,
      PROVIDER_RELEASE_TAG: tag,
      PROVIDER_DIST_DIR: dist,
      PROVIDER_REGISTRY_PATH: registryPath,
    },
    encoding: "utf8",
  });
  if (verification.status !== 0) {
    throw new Error(
      `Fixture verification ${tag} failed:\n${verification.stdout}\n${verification.stderr}`,
    );
  }
  const releaseDir = path.join(simulatedReleases, tag);
  fs.mkdirSync(releaseDir, { recursive: true });
  for (const entry of fs.readdirSync(dist)) {
    if (entry.endsWith(".zip")) {
      fs.copyFileSync(path.join(dist, entry), path.join(releaseDir, entry));
    }
  }
  fs.copyFileSync(registryPath, path.join(releaseDir, "registry.json"));
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const expectedAssets = [
    "registry.json",
    ...registry.providers.map((entry) => `${entry.id}.zip`),
  ].sort((left, right) => left.localeCompare(right));
  const actualAssets = fs
    .readdirSync(releaseDir)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualAssets) !== JSON.stringify(expectedAssets)) {
    throw new Error(
      `${tag}: immutable release assets differ: expected ${expectedAssets.join(", ")}; got ${actualAssets.join(", ")}`,
    );
  }
  if (
    sha256File(path.join(releaseDir, "registry.json")) !==
    sha256File(registryPath)
  ) {
    throw new Error(`${tag}: immutable registry bytes changed while staging`);
  }
  return { registry, registryPath, releaseDir, expectedAssets };
}

async function verifySavedRegistry(registry, expectedTag) {
  for (const entry of registry.providers) {
    const match = entry.downloadUrl.match(/\/releases\/download\/([^/]+)\/([^/]+\.zip)$/);
    if (!match || match[1] !== expectedTag) {
      throw new Error(`${entry.id}: saved registry does not reference ${expectedTag}`);
    }
    const archivePath = path.join(simulatedReleases, match[1], match[2]);
    if (!fs.existsSync(archivePath)) {
      throw new Error(`${entry.id}: retained immutable archive is missing`);
    }
    const bytes = fs.readFileSync(archivePath);
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`${entry.id}: retained archive checksum differs from saved registry`);
    }
    const archive = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    if (manifest.id !== entry.id || manifest.version !== entry.version || manifest.kind !== entry.kind) {
      throw new Error(`${entry.id}: retained archive identity differs from saved registry`);
    }
  }
}

try {
  const savedOldRelease = buildRelease(oldTag);
  const latestRelease = buildRelease(newTag);
  const mutableRelease = path.join(simulatedReleases, "material-registry-latest");
  fs.mkdirSync(mutableRelease, { recursive: true });
  fs.copyFileSync(
    latestRelease.registryPath,
    path.join(mutableRelease, "registry.json"),
  );

  await verifySavedRegistry(savedOldRelease.registry, oldTag);
  await verifySavedRegistry(latestRelease.registry, newTag);
  const pointerAssets = fs.readdirSync(mutableRelease);
  if (pointerAssets.length !== 1 || pointerAssets[0] !== "registry.json") {
    throw new Error("Mutable material registry release must contain only registry.json");
  }
  console.log(
    `[verify-retained-registry] ok (${savedOldRelease.registry.providers.length} retained archives, ${savedOldRelease.expectedAssets.length} exact immutable assets, registry-only mutable pointer)`,
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
