import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
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
const packageMetadata = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const repoUrl =
  process.env.PROVIDER_REPO_URL ||
  "https://github.com/X-T-E-R/material-providers";
const mutableRegistryTag = "material-registry-latest";
const releaseTag =
  process.env.PROVIDER_RELEASE_TAG ||
  `material-providers-v${packageMetadata.version}`;
if (releaseTag === mutableRegistryTag) {
  throw new Error(
    `${mutableRegistryTag} is registry-only; provider archives require a unique immutable release tag`,
  );
}
const releaseBase = resolveReleaseBase(repoUrl, releaseTag);
const zipDate = new Date(Date.UTC(1980, 0, 1, 0, 0, 0, 0));

function resolveReleaseBase(input, tag) {
  const normalized = input.trim().replace(/\/+$/, "");
  const githubMatch = normalized.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
  );
  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    return `https://github.com/${owner}/${repo}/releases/download/${tag}`;
  }
  const releaseMatch = normalized.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/releases(?:\/download\/([^/]+)|\/latest\/download)$/i,
  );
  if (releaseMatch) {
    const [, owner, repo, explicitTag] = releaseMatch;
    const resolvedTag = explicitTag || tag;
    if (resolvedTag === mutableRegistryTag) {
      throw new Error(
        `${mutableRegistryTag} is registry-only; provider archives require a unique immutable release tag`,
      );
    }
    return `https://github.com/${owner}/${repo}/releases/download/${resolvedTag}`;
  }
  throw new Error(`Unsupported PROVIDER_REPO_URL: ${input}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requirePackageFile(id, filename) {
  const filePath = path.join(packagesDir, id, filename);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Material provider ${id} is missing ${filename}`);
  }
  return filePath;
}

function readProviderEntry(id) {
  const packageDir = path.join(packagesDir, id);
  const entryTs = path.join(packageDir, "index.ts");
  const entryJs = path.join(packageDir, "provider.js");
  if (fs.existsSync(entryTs)) return { kind: "typescript", path: entryTs };
  if (fs.existsSync(entryJs)) return { kind: "javascript", path: entryJs };
  throw new Error(`Material provider ${id} must include index.ts or provider.js`);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(path.dirname(registryPath), { recursive: true });

const ids = fs
  .readdirSync(packagesDir)
  .filter((entry) => fs.statSync(path.join(packagesDir, entry)).isDirectory())
  .sort((left, right) => left.localeCompare(right));

const registry = { providers: [] };
const manifestIds = new Set();

for (const id of ids) {
  const manifestPath = requirePackageFile(id, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== id) {
    throw new Error(
      `Provider directory ${id} contains manifest id ${String(manifest.id)}`,
    );
  }
  if (manifestIds.has(manifest.id)) {
    throw new Error(`Duplicate material provider manifest id: ${manifest.id}`);
  }
  manifestIds.add(manifest.id);

  const entry = readProviderEntry(id);
  let providerJs;
  if (entry.kind === "typescript") {
    const result = await esbuild.build({
      entryPoints: [entry.path],
      bundle: true,
      platform: "neutral",
      target: "es2022",
      format: "iife",
      globalName: "__material_provider_exports",
      write: false,
      logLevel: "warning",
      legalComments: "none",
    });
    const bundled = result.outputFiles?.[0]?.text;
    if (!bundled) throw new Error(`Failed to bundle provider ${id}`);
    providerJs = `${bundled}\n;globalThis.__material_provider_exports = __material_provider_exports;\n`;
  } else {
    providerJs = fs.readFileSync(entry.path, "utf8");
    if (!providerJs.includes("globalThis.__material_provider_exports")) {
      throw new Error(
        `Provider ${id} provider.js must assign globalThis.__material_provider_exports`,
      );
    }
  }

  const providerBytes = Buffer.from(providerJs, "utf8");
  const packagedManifest = {
    ...manifest,
    integrity: { sha256: sha256(providerBytes) },
  };
  const manifestText = `${JSON.stringify(packagedManifest, null, 2)}\n`;

  const bundleDir = path.join(distDir, id);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), manifestText, "utf8");
  fs.writeFileSync(path.join(bundleDir, "provider.js"), providerJs, "utf8");

  const zip = new JSZip();
  const zipFileOptions = {
    date: zipDate,
    createFolders: false,
    unixPermissions: 0o100644,
  };
  zip.file("manifest.json", manifestText, zipFileOptions);
  zip.file("provider.js", providerJs, zipFileOptions);
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    streamFiles: false,
  });
  const zipName = `${id}.zip`;
  fs.writeFileSync(path.join(distDir, zipName), zipBuffer);

  const minCliVersion =
    typeof manifest.minCliVersion === "string" && manifest.minCliVersion
      ? manifest.minCliVersion
      : "0.1.0";
  registry.providers.push({
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    downloadUrl: `${releaseBase}/${zipName}`,
    sha256: sha256(zipBuffer),
    minCliVersion,
  });
  console.log(`[build-providers] built ${id}`);
}

fs.writeFileSync(
  registryPath,
  `${JSON.stringify(registry, null, 2)}\n`,
  "utf8",
);
console.log(
  `[build-providers] wrote ${registryPath} (${registry.providers.length} providers, archive tag ${releaseTag})`,
);
