import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const packagesDir = path.join(root, "src", "providers", "packages");
const distDir = path.join(root, "dist");
const repoUrl = process.env.PROVIDER_REPO_URL || "https://github.com/X-T-E-R/material-providers";
const releaseTag = process.env.PROVIDER_RELEASE_TAG || "material-registry-latest";
const releaseBase = resolveReleaseBase(repoUrl, releaseTag);

function resolveReleaseBase(input, tag) {
  const normalized = input.trim().replace(/\/+$/, "");
  const githubMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    return `https://github.com/${owner}/${repo}/releases/download/${tag}`;
  }
  const releaseMatch = normalized.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/releases(?:\/download\/([^/]+)|\/latest\/download)$/i,
  );
  if (releaseMatch) {
    const [, owner, repo, explicitTag] = releaseMatch;
    return `https://github.com/${owner}/${repo}/releases/download/${explicitTag || tag}`;
  }
  throw new Error(`Unsupported PROVIDER_REPO_URL: ${input}`);
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function injectManifestIntegrity(manifestText, entryBytes) {
  const manifest = JSON.parse(manifestText);
  manifest.integrity = { sha256: sha256Hex(entryBytes) };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const ids = fs
  .readdirSync(packagesDir)
  .filter((entry) => fs.statSync(path.join(packagesDir, entry)).isDirectory())
  .sort((a, b) => a.localeCompare(b));

const registry = { providers: [] };

for (const id of ids) {
  const packageDir = path.join(packagesDir, id);
  const manifestPath = path.join(packageDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    continue;
  }

  const manifestText = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const entryTs = path.join(packageDir, "index.ts");
  const entryJs = path.join(packageDir, "provider.js");

  let providerJs;
  if (fs.existsSync(entryTs)) {
    const result = await esbuild.build({
      entryPoints: [entryTs],
      bundle: true,
      platform: "neutral",
      target: "es2022",
      format: "iife",
      globalName: "__material_provider_exports",
      write: false,
      logLevel: "warning",
      legalComments: "none",
    });
    providerJs = result.outputFiles?.[0]?.text;
    if (!providerJs) {
      throw new Error(`Failed to bundle provider ${id}`);
    }
    providerJs = `${providerJs}\n;globalThis.__material_provider_exports = __material_provider_exports;\n`;
  } else if (fs.existsSync(entryJs)) {
    providerJs = fs.readFileSync(entryJs, "utf8");
    if (!providerJs.includes("__material_provider_exports")) {
      throw new Error(`Provider ${id} provider.js must export __material_provider_exports`);
    }
  } else {
    throw new Error(`Provider ${id} must include index.ts or provider.js`);
  }

  const entryBytes = Buffer.from(providerJs, "utf8");
  const distManifestText = injectManifestIntegrity(manifestText, entryBytes);

  const bundleDir = path.join(distDir, id);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), distManifestText, "utf8");
  fs.writeFileSync(path.join(bundleDir, "provider.js"), providerJs, "utf8");

  const zip = new JSZip();
  zip.file("manifest.json", distManifestText);
  zip.file("provider.js", providerJs);
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
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
    sha256: sha256Hex(zipBuffer),
    minCliVersion,
  });
  console.log(`[build-providers] built ${id}`);
}

fs.writeFileSync(path.join(root, "registry.json"), JSON.stringify(registry, null, 2) + "\n", "utf8");
console.log(`[build-providers] wrote registry.json (${registry.providers.length} providers)`);
