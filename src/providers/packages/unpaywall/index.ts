/**
 * Unpaywall artifact_resolver — DOI to ordered OA candidate locations.
 */

const PROVIDER_ID = "unpaywall";
const API_BASE = "https://api.unpaywall.org/v2";

interface MaterialRuntimeContext {
  http: {
    get<T = unknown>(
      url: string,
      options?: { headers?: Record<string, string>; timeout?: number },
    ): Promise<{ data: T; status: number; statusText: string; headers: Record<string, string> }>;
  };
  config: {
    get<T = unknown>(key: string, defaultValue?: T): T;
  };
}

interface MaterialIdentifierInput {
  scheme: "doi";
  value: string;
}

interface UnpaywallOaLocation {
  host_type?: string;
  repository_institution?: string;
  license?: string | null;
  url?: string | null;
  url_for_pdf?: string | null;
  url_for_landing_page?: string | null;
  version?: string | null;
  is_best?: boolean;
}

interface UnpaywallWork {
  doi?: string;
  is_oa?: boolean;
  best_oa_location?: UnpaywallOaLocation | null;
  oa_locations?: UnpaywallOaLocation[];
}

export class MaterialResolverIdentifierNotFoundError extends Error {
  readonly code = "identifier_not_found";

  constructor(doi: string) {
    super(`DOI not found in Unpaywall: ${doi}`);
    this.name = "MaterialResolverIdentifierNotFoundError";
  }
}

function requireEmail(runtimeContext: MaterialRuntimeContext): string {
  const value = runtimeContext.config.get("email", "");
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      "Missing Unpaywall contact email; set config email or UNPAYWALL_EMAIL environment variable.",
    );
  }
  return value.trim();
}

function encodeDoiPath(doi: string): string {
  return encodeURIComponent(doi);
}

function pickLocationUrl(location: UnpaywallOaLocation): string | null {
  const candidates = [location.url_for_pdf, location.url].filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  for (const url of candidates) {
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      continue;
    }
  }
  return null;
}

function mapLocation(location: UnpaywallOaLocation) {
  const url = pickLocationUrl(location);
  if (!url) return null;

  const license =
    typeof location.license === "string" && location.license.trim() ? location.license.trim() : undefined;
  const version =
    typeof location.version === "string" && location.version.trim() ? location.version.trim() : undefined;
  const hostParts = [location.host_type, location.repository_institution].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  const host = hostParts.length > 0 ? hostParts.join(":") : undefined;
  const contentType = /\.pdf(?:[?#]|$)/i.test(url) ? "application/pdf" : undefined;

  return {
    url,
    ...(license ? { license } : {}),
    ...(version ? { version } : {}),
    ...(host ? { host } : {}),
    ...(contentType ? { contentType } : {}),
  };
}

function locationKey(location: UnpaywallOaLocation): string {
  return pickLocationUrl(location) ?? JSON.stringify(location);
}

function orderedCandidates(work: UnpaywallWork): ReturnType<typeof mapLocation>[] {
  const ordered: UnpaywallOaLocation[] = [];
  const seen = new Set<string>();

  const push = (loc: UnpaywallOaLocation | null | undefined) => {
    if (!loc) return;
    const key = locationKey(loc);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(loc);
  };

  push(work.best_oa_location);
  for (const loc of work.oa_locations ?? []) {
    push(loc);
  }

  const mapped = [];
  for (const loc of ordered) {
    const candidate = mapLocation(loc);
    if (candidate) mapped.push(candidate);
  }
  return mapped;
}

function createProvider(runtimeContext: MaterialRuntimeContext) {
  return {
    inspect() {
      const email = runtimeContext.config.get("email", "");
      return {
        contractVersion: "paper-search.material-provider.unpaywall.v1",
        id: PROVIDER_ID,
        service: "Unpaywall REST API",
        kind: "artifact_resolver",
        network: true,
        inputs: ["identifier"],
        identifierSchemes: ["doi"],
        outputs: ["locations"],
        requiredConfig: ["email"],
        configuredEmail: typeof email === "string" && email.trim() ? "<set>" : "<missing>",
        methods: ["inspect", "resolve"],
        liveNetworkDuringInspect: false,
      };
    },

    async resolve(input: {
      identifier: MaterialIdentifierInput;
      policy?: string;
      attachTo?: string;
    }) {
      const identifier = input?.identifier;
      if (!identifier || identifier.scheme !== "doi" || typeof identifier.value !== "string") {
        throw new Error("resolve() requires identifier with scheme doi and a non-empty value");
      }

      const doi = identifier.value.trim();
      const email = requireEmail(runtimeContext);
      const url = `${API_BASE}/${encodeDoiPath(doi)}?email=${encodeURIComponent(email)}`;

      let response;
      try {
        response = await runtimeContext.http.get<UnpaywallWork>(url, { timeout: 30_000 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unpaywall request failed: ${message}`);
      }

      if (response.status === 404) {
        throw new MaterialResolverIdentifierNotFoundError(doi);
      }
      if (response.status === 422) {
        throw new Error(
          `Unpaywall rejected the request (HTTP 422): use a real contact email in config or UNPAYWALL_EMAIL`,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Unpaywall returned HTTP ${response.status}: ${response.statusText}`);
      }

      const work = response.data ?? {};
      const candidates = orderedCandidates(work);
      const retrievedAt = new Date().toISOString();

      return {
        identifier: { scheme: "doi" as const, value: doi },
        candidates,
        provenance: {
          providerId: PROVIDER_ID,
          source: "unpaywall",
          retrievedAt,
        },
      };
    },
  };
}

export { createProvider };
