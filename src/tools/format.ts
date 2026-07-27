const MAX_OUTPUT_CHARS = 80_000;

/**
 * Resolve the Datadog web-app host for a configured API site.
 *
 * `DD_SITE` holds an API host (e.g. "datadoghq.eu", "us3.datadoghq.com"). The
 * matching web app lives on the same domain, prefixed with "app." for the bare
 * two-label sites. Subdomained sites (us3/us5/ap1/…) are already app-routable.
 */
export function appHost(site: string): string {
  return site.split(".").length > 2 ? site : `app.${site}`;
}

/** Build an absolute Datadog web-app URL for the configured site. */
export function appUrl(site: string, path: string): string {
  return `https://${appHost(site)}/${path.replace(/^\//, "")}`;
}

export function truncate(str: string | undefined | null, maxLen: number): string | undefined {
  if (!str) return str ?? undefined;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

export function truncateTags(tags: string[] | undefined | null, max = 10): string[] | undefined {
  if (!tags) return undefined;
  if (tags.length <= max) return tags;
  return [...tags.slice(0, max), `... and ${tags.length - max} more`];
}

export function formatToolOutput(data: unknown, label: string, count?: number): string {
  const prefix = count !== undefined ? `Found ${count} ${label}:\n` : "";
  let json = JSON.stringify(data);

  if (prefix.length + json.length > MAX_OUTPUT_CHARS) {
    const available = MAX_OUTPUT_CHARS - prefix.length - 100;
    json = json.slice(0, available) + `\n\n[OUTPUT TRUNCATED — exceeded ${MAX_OUTPUT_CHARS} char limit]`;
  }

  return prefix + json;
}
