import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncate, truncateTags, formatToolOutput } from "./format.js";

export function registerLogsTool(server: McpServer, config: DatadogConfig) {
  const api = new v2.LogsApi(config.configuration);

  server.tool(
    "query_logs",
    "Search Datadog logs using the standard log query syntax (e.g. 'service:web-app status:error'). Returns matching log events with timestamps, messages, and attributes. Set full_output to true for untruncated results.",
    {
      query: z
        .string()
        .describe(
          "Datadog log query string (e.g. 'service:my-app status:error @http.status_code:500')"
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
        .describe("Max number of logs to return (1-100)"),
      sort: z
        .enum(["timestamp", "-timestamp"])
        .default("-timestamp")
        .describe("Sort order: '-timestamp' (newest first) or 'timestamp' (oldest first)"),
      full_output: z
        .boolean()
        .default(false)
        .describe("When true, return full log messages and all attributes without truncation. Use with a small limit to avoid huge responses."),
    },
    async ({ query, from, to, limit, sort, full_output }) => {
      try {
        const response = await api.listLogsGet({
          filterQuery: query,
          filterFrom: new Date(resolveRelativeTime(from)),
          filterTo: new Date(resolveRelativeTime(to)),
          pageLimit: limit,
          sort: sort as v2.LogsSort,
        });

        const logs = response.data ?? [];

        if (logs.length === 0) {
          return { content: [{ type: "text", text: "No logs found for the given query and time range." }] };
        }

        const formatted = logs.map((log) => {
          const attrs = log.attributes ?? {};

          if (full_output) {
            return {
              id: log.id,
              timestamp: attrs.timestamp,
              status: attrs.status,
              service: attrs.service,
              message: attrs.message,
              host: attrs.host,
              tags: attrs.tags,
              attributes: attrs.attributes,
            };
          }

          return {
            id: log.id,
            timestamp: attrs.timestamp,
            status: attrs.status,
            service: attrs.service,
            message: truncate(attrs.message as string | undefined, 500),
            host: attrs.host,
            tags: truncateTags(attrs.tags as string[] | undefined),
          };
        });

        const text = full_output
          ? JSON.stringify(formatted, null, 2)
          : formatToolOutput(formatted, "logs", logs.length);

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to query logs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_log_by_id",
    "Retrieve a single log by its ID with full, untruncated attributes and message. Use after query_logs to inspect a specific log in detail.",
    {
      log_id: z
        .string()
        .describe("The log ID (returned by query_logs in the 'id' field)"),
      query: z
        .string()
        .describe("The original search query used in query_logs (needed to locate the log)"),
      from: z
        .string()
        .default("now-1d")
        .describe("Start time — should cover when the log was generated"),
      to: z
        .string()
        .default("now")
        .describe("End time"),
    },
    async ({ log_id, query, from, to }) => {
      try {
        for await (const log of api.listLogsGetWithPagination({
          filterQuery: query,
          filterFrom: new Date(resolveRelativeTime(from)),
          filterTo: new Date(resolveRelativeTime(to)),
          pageLimit: 100,
        })) {
          if (log.id === log_id) {
            const attrs = log.attributes ?? {};
            const result = {
              id: log.id,
              timestamp: attrs.timestamp,
              status: attrs.status,
              service: attrs.service,
              message: attrs.message,
              host: attrs.host,
              tags: attrs.tags,
              attributes: attrs.attributes,
            };
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }
        }

        return {
          content: [{ type: "text", text: `Log with ID '${log_id}' not found. Make sure the query and time range match the original search.` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get log: ${error instanceof Error ? error.message : String(error)}`,
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
