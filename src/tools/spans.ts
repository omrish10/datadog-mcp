import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncateTags, formatToolOutput } from "./format.js";

export function registerSpansTool(server: McpServer, config: DatadogConfig) {
  const api = new v2.SpansApi(config.configuration);

  server.tool(
    "search_spans",
    "Search Datadog APM spans/traces using span search syntax (e.g. 'service:gateway @duration:>1s', 'env:prod resource_name:\"/api/users\"'). Returns matching spans with trace IDs, durations, and tags.",
    {
      query: z
        .string()
        .describe(
          "Datadog span search query (e.g. 'service:my-app env:prod @duration:>500ms resource_name:\"/api/users\"')"
        ),
      from: z
        .string()
        .default("now-1h")
        .describe("Start time — ISO-8601 or relative like 'now-15m', 'now-1h', 'now-1d'"),
      to: z
        .string()
        .default("now")
        .describe("End time — ISO-8601 or relative like 'now'"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Max number of spans to return (1-100)"),
      sort: z
        .enum(["timestamp", "-timestamp"])
        .default("-timestamp")
        .describe("Sort order: '-timestamp' (newest first) or 'timestamp' (oldest first)"),
    },
    async ({ query, from, to, limit, sort }) => {
      try {
        const response = await api.listSpansGet({
          filterQuery: query,
          filterFrom: resolveRelativeTime(from),
          filterTo: resolveRelativeTime(to),
          pageLimit: limit,
          sort: sort as v2.SpansSort,
        });

        const spans = response.data ?? [];

        if (spans.length === 0) {
          return { content: [{ type: "text", text: "No spans found for the given query and time range." }] };
        }

        const formatted = spans.map((span) => {
          const attrs = span.attributes ?? {};
          const tags = attrs.tags as string[] | undefined;
          const startNs = attrs.startTimestamp as string | undefined;
          const endNs = attrs.endTimestamp as string | undefined;

          let durationMs: number | undefined;
          if (startNs && endNs) {
            durationMs = (new Date(endNs).getTime() - new Date(startNs).getTime());
          }

          return {
            traceId: attrs.traceId,
            spanId: attrs.spanId,
            service: attrs.service,
            resourceName: attrs.resourceName,
            type: attrs.type,
            env: attrs.env,
            host: attrs.host,
            startTimestamp: startNs,
            endTimestamp: endNs,
            durationMs,
            tags: truncateTags(tags),
          };
        });

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "spans", spans.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to search spans: ${error instanceof Error ? error.message : String(error)}`,
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
