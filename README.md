# Material Providers

Official external **material** provider repository for [paper-search-cli](https://github.com/X-T-E-R/paper-search-cli).

Material providers implement acquisition and extraction adapters (`artifact_resolver`, `artifact_downloader`, `extractor`, and related kinds). They are installed separately from [resource-search-providers](https://github.com/X-T-E-R/resource-search-providers), which only publishes **search** sources for the Zotero plugin.

---

## What This Repository Is For

- Distribute installable material provider packages for `paper-search-cli`
- Publish a dedicated `registry.json` with `kind`, `downloadUrl`, `sha256`, and `minCliVersion` entries (see ADR in the parent MetaSystem: material-provider distribution channel)
- Build release zip archives via CI without committing `dist/` or `registry.json` to git

Default registry URL (after release):

`https://github.com/X-T-E-R/material-providers`

Use with:

```bash
node dist/cli.js providers plan-registry <path-or-url-to-registry.json> --kind material --json
```

Remote registry URLs require a paper-search-cli build that supports HTTP material registries; until then, point the CLI at a **local** `registry.json` produced by `npm run build`, or install zips with `providers install-zip`.

---

## Package Layout

Each provider lives under:

`src/providers/packages/<id>/`

Every package contains at least:

- `manifest.json` — `MaterialProviderManifest` contract (`kind`, `capabilities`, `permissions`, optional `configSchema`, `rateLimit`)
- `index.ts` or `provider.js` — bundled to `provider.js` in release artifacts

---

## Release Model

1. Change provider source under `src/providers/packages/`
2. `npm run build` generates `dist/<id>/` folders, `dist/<id>.zip` archives, and root `registry.json`
3. `npm run verify` checks manifest/registry version alignment and zip checksums
4. GitHub Actions (when configured) uploads `registry.json` and `dist/*.zip` to the mutable release tag `material-registry-latest`

Build artifacts and `registry.json` are gitignored; only source and scripts are versioned.

---

## License

MIT
