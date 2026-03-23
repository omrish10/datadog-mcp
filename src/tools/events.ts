import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncate, truncateTags, formatToolOutput } from "./format.js";

export function registerEventsTool(server: McpServer, config: DatadogConfig) {
  const api = new v2.EventsApi(config.configuration);

  server.tool(
    "query_events",
    "Search the Datadog event stream for deploys, alerts, and configuration changes. Use to correlate events with incidents or performance issues.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Event search query (e.g. 'sources:deploy', 'tags:service:web-app')"
        ),
      from: z
        .string()
        .default("now-1d")
        .describe("Start time — ISO-8601 or relative like 'now-15m', 'now-1h', 'now-1d'"),
      to: z
        .string()
        .default("now")
        .describe("End time — ISO-8601 or relative like 'now'"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Max events to return (1-50)"),
      sort: z
        .enum(["timestamp", "-timestamp"])
        .default("-timestamp")
        .describe("Sort order: '-timestamp' (newest first) or 'timestamp' (oldest first)"),
    },
    async ({ query, from, to, limit, sort }) => {
      try {
        const response = await api.listEvents({
          filterQuery: query,
          filterFrom: resolveRelativeTime(from),
          filterTo: resolveRelativeTime(to),
          pageLimit: limit,
          sort: sort as v2.EventsSort,
        });

        const events = response.data ?? [];

        if (events.length === 0) {
          return { content: [{ type: "text", text: "No events found for the given query and time range." }] };
        }

        const formatted = events.map((event) => {
          const attrs = event.attributes ?? {};
          const innerAttrs = attrs.attributes;

          return {
            eventId: event.id,
            timestamp: attrs.timestamp,
            title: innerAttrs?.title,
            text: truncate(attrs.message, 500),
            tags: truncateTags(attrs.tags),
            source: innerAttrs?.sourceTypeName,
            priority: innerAttrs?.priority,
            service: innerAttrs?.service,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "events", events.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to query events: ${error instanceof Error ? error.message : String(error)}`,
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
