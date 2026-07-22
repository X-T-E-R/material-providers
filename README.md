# Material Providers for Paper Search CLI X

This is the independent material-provider repository for
[`paper-search-cli`](https://github.com/X-T-E-R/paper-search-cli). It publishes
installable packages for resolving artifact locations, acquiring files, and
extracting material such as PDFs. Search-source packages are maintained
separately in
[`resource-search-providers`](https://github.com/X-T-E-R/resource-search-providers).

Paper Search CLI X owns orchestration, provider installation, records, and local
workspace storage. Networked PDF acquisition and parsing belong to installed
material providers; the CLI does not offer a direct-download path that bypasses
the selected provider. A provider can access only the services and local
resources declared by its own manifest and supported by the host runtime.

## Available providers

| Provider ID | Kind | What it does | Required configuration |
| --- | --- | --- | --- |
| `unpaywall` | `artifact_resolver` | Resolves a DOI to ordered open-access location metadata through the Unpaywall API. It does not download file bytes. | `UNPAYWALL_EMAIL` |
| `mineru-extractor` | `extractor` | Sends URL-based extraction jobs to MinerU and returns Markdown, JSON, assets, or result-zip metadata. Its local-file upload flow is exposed as a host-mediated contract rather than a standalone live upload. | `MINERU_TOKEN` or `MINERU_API_TOKEN` |

This registry does not currently publish an `artifact_downloader`. Resolving a
DOI with `unpaywall` therefore identifies candidate locations but does not, by
itself, acquire the PDF. File acquisition requires an installed downloader
provider that accepts the candidate and is permitted to access its source.

Provider IDs are machine-facing identifiers. Use them exactly as shown in the
registry, commands, configuration, and automation.

## Add the registry and install providers

The discovery registry is published at:

```text
https://github.com/X-T-E-R/material-providers/releases/download/material-registry-latest/registry.json
```

Add and refresh it with Paper Search CLI X:

```bash
paper-search registries add official-material https://github.com/X-T-E-R/material-providers/releases/download/material-registry-latest/registry.json --kind material --apply
paper-search registries refresh official-material
paper-search providers available --json
```

Install a provider explicitly from the material registry:

```bash
paper-search providers install unpaywall --from official-material --apply --json
paper-search providers install mineru-extractor --from official-material --apply --json
```

Refreshing a registry validates and snapshots its metadata; it does not install
provider code. Provider installation is also plan-first unless `--apply` is
present.

Set credentials in the environment before running the corresponding provider:

```bash
export UNPAYWALL_EMAIL="you@example.org"
export MINERU_TOKEN="<token-issued-by-mineru>"
```

Use the equivalent environment-setting syntax for your shell. Do not commit
provider credentials to this repository or to project configuration.

## Source and authorization boundaries

Each provider declares its network, read, write, and credential requirements in
`manifest.json`. Review that manifest before installation and enable only the
providers and sources you intend to use. Registry checks and archive digests
verify package identity and installation integrity; they do not decide whether
you are entitled to retrieve or process a particular document.

You remain responsible for choosing sources and for following the applicable
provider terms, licences, institutional access conditions, copyright rules, and
local law. Provider metadata such as an open-access location or licence hint is
input to that decision, not a legal determination or a guarantee that every
linked file may be downloaded or reused.

## Package contract

Provider source packages live under:

```text
src/providers/packages/<id>/
```

Each package contains at least:

- `manifest.json` — the material-provider contract, including `kind`,
  `capabilities`, `permissions`, optional `configSchema`, and optional
  `rateLimit`
- `index.ts` or `provider.js` — bundled as `provider.js` in the release archive

Supported material-provider kinds include `artifact_resolver`,
`artifact_downloader`, `extractor`, `converter`, and `enricher`. Resolver
providers return candidate metadata rather than bytes; downloader providers
perform acquisition; extractor providers turn a URL or acquired artifact into
derived outputs.

## Build and release

This repository is private as an npm package. Providers are distributed as
GitHub release assets rather than published to npm.

1. Update a package under `src/providers/packages/`.
2. Run `npm run build` to generate `dist/<id>/`, `dist/<id>.zip`, and the root
   `registry.json`.
3. Run `npm run verify:release` to check types, manifests, registries, archives,
   reproducible ZIP bytes, retained-registry publication, and the release plan.
4. Pull-request CI runs the same release gate. Publication from `main` uploads
   the exact archives and registry to an immutable
   `material-providers-<commit>` release.
5. After the immutable release is verified, the workflow updates the
   registry-only `material-registry-latest` discovery release.

For an offline summary without contacting GitHub or changing a release, run:

```bash
npm run release:plan
```

Generated `dist/` content and `registry.json` are not source-controlled. Public
registry entries retain the
`id/version/kind/downloadUrl/sha256/minCliVersion` shape, and each `downloadUrl`
targets an immutable archive release.

## License

[MIT License](./LICENSE)
