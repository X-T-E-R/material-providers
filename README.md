# Material Providers

Official external **material** provider repository for [paper-search-cli](https://github.com/X-T-E-R/paper-search-cli).

Material providers implement acquisition and extraction adapters (`artifact_resolver`, `artifact_downloader`, `extractor`, and related kinds). They are installed separately from [resource-search-providers](https://github.com/X-T-E-R/resource-search-providers), which only publishes **search** sources for the Zotero plugin.

---

## What This Repository Is For

- Distribute installable material provider packages for `paper-search-cli`
- Publish a dedicated `registry.json` with `kind`, `downloadUrl`, `sha256`, and
  `minCliVersion` entries for material-provider discovery
- Build release zip archives via CI without committing `dist/` or `registry.json` to git

Default registry URL (after the repository's first release):

`https://github.com/X-T-E-R/material-providers/releases/download/material-registry-latest/registry.json`

Use with:

```bash
paper-search registries add official-material https://github.com/X-T-E-R/material-providers/releases/download/material-registry-latest/registry.json --kind material --apply
paper-search registries refresh official-material
paper-search providers available --json
paper-search providers install unpaywall --from official-material --apply --json
```

Registry refresh validates and snapshots metadata; it does not install provider
code. Installation remains an explicit, plan-first CLI operation.

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
3. `npm run verify:release` checks types, manifest/registry/archive alignment,
   deterministic ZIP bytes across time zones, and a retained-old-registry
   publish simulation
4. Read-only pull-request CI verifies the same release gate; `main` is the
   stable publication channel
5. GitHub Actions publishes the exact `dist/*.zip` set plus the corresponding
   `registry.json` to the unique immutable tag `material-providers-<commit>`,
   then byte-verifies every asset
6. Only after that immutable release is complete, the workflow replaces
   `registry.json` on the mutable discovery tag `material-registry-latest`;
   that release remains registry-only

Run `npm run release:plan` for an offline dry-run summary. It does not contact
GitHub or mutate releases. Registry entries keep the public
`id/version/kind/downloadUrl/sha256/minCliVersion` shape, and every
`downloadUrl` points to an immutable archive release.

Build artifacts and `registry.json` are gitignored; only source and scripts are versioned.
Manual publication runs are restricted to `main`. The npm package remains
`private`; providers are distributed as GitHub release assets and are not
published to npm.

---

## License

[MIT License](./LICENSE)
