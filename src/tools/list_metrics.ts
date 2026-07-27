import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1, v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { formatToolOutput } from "./format.js";

const MAX_RESULTS = 200;

/** Page size for the v2 metrics listing (10000 is the API maximum). */
const SCAN_PAGE_SIZE = 10_000;

/**
 * Upper bound on metrics inspected during a name search.
 *
 * `/api/v2/metrics` has no server-side name filter, so searching means paging
 * through the org's metrics and matching locally. The cap keeps a broad search
 * from turning into an unbounded walk; callers are told when it is hit.
 */
const SCAN_LIMIT = 100_000;

export function registerListMetricsTool(server: McpServer, config: DatadogConfig) {
  const metricsV1 = new v1.MetricsApi(config.configuration);
  const metricsV2 = new v2.MetricsApi(config.configuration);

  server.registerTool(
    "list_metrics",
    {
      title: "List Metrics",
      description:
        "Discover available Datadog metric names. Use 'search' to find metrics by prefix/keyword (e.g. 'system.cpu', 'trace.servlet'), or omit it to list all actively-reporting metrics.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe(
            "Keyword or prefix to search for metric names (e.g. 'system.cpu', 'trace.servlet'). Matched as a case-insensitive substring. If omitted, lists all active metrics."
          ),
        from: z
          .string()
          .default("now-1h")
          .describe(
            "Start time for active metrics window — relative like 'now-1h' or ISO-8601. Only used when 'search' is omitted."
          ),
        host: z
          .string()
          .optional()
          .describe("Filter active metrics by hostname. Only used when 'search' is omitted."),
        tag_filter: z
          .string()
          .optional()
          .describe("Filter active metrics by tag expression. Only used when 'search' is omitted."),
      },
    },
    async ({ search, from, host, tag_filter }) => {
      try {
        const output = search
          ? await searchMetricNames(metricsV2, search)
          : await listActiveMetricNames(metricsV1, from, host, tag_filter);

        if (output.metrics.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No metrics found matching the given criteria." },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: formatToolOutput(output, "metrics", output.total),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to list metrics: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

interface MetricListOutput {
  metrics: string[];
  returned: number;
  total: number;
  truncated: boolean;
  /** Number of metrics inspected — only set for name searches. */
  scanned?: number;
  /** True when the search stopped at SCAN_LIMIT and may have missed matches. */
  scanIncomplete?: boolean;
}

/**
 * Search metric names via `/api/v2/metrics`.
 *
 * Replaces the deprecated v1 `listMetrics` search endpoint. The v2 endpoint
 * lists metrics rather than searching them, so the substring match is applied
 * client-side while paging.
 */
async function searchMetricNames(
  api: v2.MetricsApi,
  search: string
): Promise<MetricListOutput> {
  const needle = search.replace(/^metrics:/, "").toLowerCase();
  const matches: string[] = [];
  let scanned = 0;
  let scanIncomplete = false;
  let cursor: string | undefined;

  // Paged manually rather than with listTagConfigurationsWithPagination: the
  // SDK's generator only stops when nextCursor is `undefined`, but Datadog
  // sends `next_cursor: null` on the last page, so it requests one page past
  // the end and the API answers 500.
  for (;;) {
    const page = await api.listTagConfigurations({
      pageSize: SCAN_PAGE_SIZE,
      ...(cursor && { pageCursor: cursor }),
    });

    const items = page.data ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      scanned++;
      const name = (item as { id?: string }).id;
      if (name && name.toLowerCase().includes(needle)) {
        matches.push(name);
      }
      if (matches.length >= MAX_RESULTS) break;
    }

    if (matches.length >= MAX_RESULTS) break;
    if (scanned >= SCAN_LIMIT) {
      scanIncomplete = true;
      break;
    }

    cursor = page.meta?.pagination?.nextCursor ?? undefined;
    if (!cursor) break;
  }

  return {
    metrics: matches,
    returned: matches.length,
    total: matches.length,
    truncated: matches.length >= MAX_RESULTS,
    scanned,
    ...(scanIncomplete && { scanIncomplete }),
  };
}

/** List actively-reporting metrics. This v1 endpoint is not deprecated. */
async function listActiveMetricNames(
  api: v1.MetricsApi,
  from: string,
  host: string | undefined,
  tagFilter: string | undefined
): Promise<MetricListOutput> {
  const fromEpoch = Math.floor(new Date(resolveRelativeTime(from)).getTime() / 1000);

  const response = await api.listActiveMetrics({ from: fromEpoch, host, tagFilter });
  const metrics = response.metrics ?? [];

  return {
    metrics: metrics.slice(0, MAX_RESULTS),
    returned: Math.min(metrics.length, MAX_RESULTS),
    total: metrics.length,
    truncated: metrics.length > MAX_RESULTS,
  };
}

function resolveRelativeTime(input: string): string {
  const match = input.match(/^now(-(\d+)([smhd]))?$/);
  if (!match) return input;

  const now = Date.now();
  if (!match[1]) return new Date(now).toISOString();

  const amount = parseInt(match[2], 10);
  const unit = match[3];
  const ms: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

  return new Date(now - amount * (ms[unit] ?? 0)).toISOString();
}
