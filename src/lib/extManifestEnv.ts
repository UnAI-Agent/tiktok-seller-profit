export const DEV_HOST_PATTERNS = [
  "http://127.0.0.1:8765/*",
  "http://127.0.0.1:8000/*",
  "http://localhost:8000/*",
] as const;

export type ExtManifestSlice = {
  name: string;
  host_permissions: string[];
  content_scripts: Array<{ matches: string[]; js: string[]; run_at?: string }>;
  externally_connectable?: { matches: string[] };
  web_accessible_resources?: Array<{
    matches: string[];
    resources: string[];
    use_dynamic_url?: boolean;
  }>;
};

export function apiHostPermission(apiBase: string): string | null {
  try {
    const origin = new URL(apiBase).origin;
    if (!origin || origin === "null") return null;
    return `${origin}/*`;
  } catch {
    return null;
  }
}

export function withBuildManifest<T extends ExtManifestSlice>(
  base: T,
  opts: { apiBase: string; name?: string; stripDevHosts?: boolean },
): T {
  const hosts = new Set(base.host_permissions);
  const extra = apiHostPermission(opts.apiBase);
  if (extra) hosts.add(extra);
  if (opts.stripDevHosts) {
    for (const h of DEV_HOST_PATTERNS) hosts.delete(h);
  }
  const extMatches = new Set(base.externally_connectable?.matches ?? []);
  for (const h of DEV_HOST_PATTERNS) {
    if (h.includes(":8000") && !opts.stripDevHosts) extMatches.add(h);
  }
  if (extra) extMatches.add(extra);
  if (opts.stripDevHosts) {
    for (const h of DEV_HOST_PATTERNS) extMatches.delete(h);
  }
  return {
    ...base,
    name: opts.name?.trim() || base.name,
    host_permissions: [...hosts],
    externally_connectable: { matches: [...extMatches] },
    content_scripts: base.content_scripts.map((cs) => {
      const isOAuthDone = cs.js.some((j) => j.includes("oauthDone"));
      let matches = opts.stripDevHosts
        ? cs.matches.filter(
            (m) => !(DEV_HOST_PATTERNS as readonly string[]).includes(m),
          )
        : [...cs.matches];
      if (isOAuthDone && extra) matches = [...new Set([...matches, extra])];
      return { ...cs, matches };
    }),
    web_accessible_resources: (base.web_accessible_resources ?? []).map((war) => {
      let matches = opts.stripDevHosts
        ? war.matches.filter(
            (m) => !(DEV_HOST_PATTERNS as readonly string[]).includes(m),
          )
        : [...war.matches];
      if (war.resources.includes("oauth-finish.html") && extra) {
        matches = [...new Set([...matches, extra])];
      }
      return { ...war, matches };
    }),
  };
}
