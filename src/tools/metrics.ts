import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { formatToolOutput } from "./format.js";

export function registerMetricsTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.MetricsApi(config.configuration);

  server.tool(
    "query_metrics",
    "Query Datadog metric timeseries data. Uses the v1 metrics query syntax (e.g. 'avg:system.cpu.user{host:myhost}').",
    {
      query: z
        .string()
        .describe(
          "Datadog metrics query (e.g. 'avg:system.cpu.user{*}', 'sum:trace.servlet.request.hits{service:web-app}.as_count()')"
        ),
      from: z
        .string()
        .default("now-1h")
        .describe("Start time — ISO-8601 or relative like 'now-1h', 'now-4h', 'now-1d'"),
      to: z
        .string()
        .default("now")
        .describe("End time — ISO-8601 or relative like 'now'"),
    },
    async ({ query, from, to }) => {
      try {
        const fromEpoch = Math.floor(
          new Date(resolveRelativeTime(from)).getTime() / 1000
        );
        const toEpoch = Math.floor(
          new Date(resolveRelativeTime(to)).getTime() / 1000
        );

        const response = await api.queryMetrics({
          from: fromEpoch,
          to: toEpoch,
          query,
        });

        const series = response.series ?? [];

        if (series.length === 0) {
          return {
            content: [{ type: "text", text: "No metric data found for the given query and time range." }],
          };
        }

        const formatted = series.map((s) => ({
          metric: s.metric,
          displayName: s.displayName,
          scope: s.scope,
          unit: s.unit ? `${s.unit[0]?.name ?? ""}` : undefined,
          pointCount: s.pointlist?.length ?? 0,
          points: (s.pointlist ?? []).slice(-20).map((p) => ({
            time: new Date((p[0] ?? 0) * 1000).toISOString(),
            value: p[1],
          })),
        }));

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "series", series.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to query metrics: ${error instanceof Error ? error.message : String(error)}`,
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
