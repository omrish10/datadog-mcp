const MAX_OUTPUT_CHARS = 80_000;

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
