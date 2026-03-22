import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { formatToolOutput } from "./format.js";

const MAX_RESULTS = 200;

export function registerListMetricsTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.MetricsApi(config.configuration);

  server.tool(
    "list_metrics",
    "Discover available Datadog metric names. Use 'search' to find metrics by prefix/keyword (e.g. 'system.cpu', 'trace.servlet'), or omit it to list all actively-reporting metrics.",
    {
      search: z
        .string()
        .optional()
        .describe(
          "Keyword or prefix to search for metric names (e.g. 'system.cpu', 'trace.servlet'). If omitted, lists all active metrics."
        ),
      from: z
        .string()
        .default("now-1h")
        .describe("Start time for active metrics window — relative like 'now-1h' or ISO-8601. Only used when 'search' is omitted."),
      host: z
        .string()
        .optional()
        .describe("Filter active metrics by hostname. Only used when 'search' is omitted."),
      tag_filter: z
        .string()
        .optional()
        .describe("Filter active metrics by tag expression. Only used when 'search' is omitted."),
    },
    async ({ search, from, host, tag_filter }) => {
      try {
        let metricNames: string[];
        let totalCount: number;

        if (search) {
          const query = search.startsWith("metrics:") ? search : `metrics:${search}`;
          const response = await api.listMetrics({ q: query });
          const results = response.results?.metrics ?? [];
          totalCount = results.length;
          metricNames = results.slice(0, MAX_RESULTS);
        } else {
          const fromEpoch = Math.floor(
            new Date(resolveRelativeTime(from)).getTime() / 1000
          );
          const response = await api.listActiveMetrics({
            from: fromEpoch,
            host,
            tagFilter: tag_filter,
          });
          const metrics = response.metrics ?? [];
          totalCount = metrics.length;
          metricNames = metrics.slice(0, MAX_RESULTS);
        }

        if (metricNames.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No metrics found matching the given criteria." }],
          };
        }

        const output = {
          metrics: metricNames,
          returned: metricNames.length,
          total: totalCount,
          truncated: totalCount > MAX_RESULTS,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: formatToolOutput(output, "metrics", totalCount),
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
