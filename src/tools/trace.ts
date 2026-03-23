import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncateTags, formatToolOutput } from "./format.js";

export function registerTraceTool(server: McpServer, config: DatadogConfig) {
  const api = new v2.SpansApi(config.configuration);

  server.tool(
    "get_trace",
    "Fetch all spans for a distributed trace by trace ID. Returns the full trace tree with timing, service, and resource information for each span.",
    {
      trace_id: z
        .string()
        .describe("The trace ID to look up"),
      from: z
        .string()
        .default("now-1h")
        .describe("Start time — ISO-8601 or relative like 'now-1h'"),
      to: z
        .string()
        .default("now")
        .describe("End time"),
    },
    async ({ trace_id, from, to }) => {
      try {
        const response = await api.listSpansGet({
          filterQuery: `@trace_id:${trace_id}`,
          filterFrom: resolveRelativeTime(from),
          filterTo: resolveRelativeTime(to),
          pageLimit: 1000,
          sort: "timestamp" as v2.SpansSort,
        });

        const spans = response.data ?? [];

        if (spans.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No spans found for trace ID ${trace_id} in the given time range.`,
              },
            ],
          };
        }

        const formatted = spans.map((span) => {
          const attrs = span.attributes ?? {};
          const tags = attrs.tags as string[] | undefined;
          const startNs = attrs.startTimestamp as string | undefined;
          const endNs = attrs.endTimestamp as string | undefined;

          let durationMs: number | undefined;
          if (startNs && endNs) {
            durationMs = new Date(endNs).getTime() - new Date(startNs).getTime();
          }

          return {
            spanId: attrs.spanId,
            parentId: attrs.parentId,
            service: attrs.service,
            resourceName: attrs.resourceName,
            type: attrs.type,
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
              text: formatToolOutput(formatted, "spans in trace", spans.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch trace: ${error instanceof Error ? error.message : String(error)}`,
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
