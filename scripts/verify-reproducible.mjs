import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const buildScript = path.join(__dirname, "build-providers.mjs");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "material-provider-repro-"));

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function collectFiles(rootDir, prefix = "") {
  const result = new Map();
  for (const entry of fs
    .readdirSync(rootDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of collectFiles(absolute, relative)) {
        result.set(key, value);
      }
    } else if (entry.isFile()) {
      result.set(relative, sha256(absolute));
    }
  }
  return result;
}

function runBuild(label, timezone) {
  const outputRoot = path.join(tempRoot, label);
  const dist = path.join(outputRoot, "dist");
  const registry = path.join(outputRoot, "registry.json");
  fs.mkdirSync(outputRoot, { recursive: true });
  const result = spawnSync(process.execPath, [buildScript], {
    cwd: root,
    env: {
      ...process.env,
      TZ: timezone,
      PROVIDER_DIST_DIR: dist,
      PROVIDER_REGISTRY_PATH: registry,
      PROVIDER_RELEASE_TAG: "material-providers-reproducibility-fixture",
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Reproducibility build ${label} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const files = collectFiles(dist);
  files.set("registry.json", sha256(registry));
  return files;
}

try {
  const first = runBuild("first", "UTC");
  const second = runBuild("second", "America/Los_Angeles");
  const keys = [...new Set([...first.keys(), ...second.keys()])].sort();
  const differences = keys.filter((key) => first.get(key) !== second.get(key));
  if (differences.length > 0) {
    throw new Error(
      `Material provider build is not reproducible: ${differences.join(", ")}`,
    );
  }
  console.log(
    `[verify-reproducible] ok (${keys.length} generated files have identical SHA-256 across UTC and America/Los_Angeles)`,
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
