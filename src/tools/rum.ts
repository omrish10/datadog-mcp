import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncate, truncateTags, formatToolOutput } from "./format.js";

export function registerRumTool(server: McpServer, config: DatadogConfig) {
  const api = new v2.RUMApi(config.configuration);

  server.tool(
    "search_rum_events",
    "Search Datadog RUM (Real User Monitoring) events — sessions, network requests, JS errors, user actions, and views. " +
      "Use RUM query syntax to filter by event type, user, application, browser, and more. " +
      "Examples: '@type:session @session.has_replay:true', '@type:resource @resource.status_code:>=400', '@type:error service:my-app'.",
    {
      query: z
        .string()
        .default("@type:session @session.has_replay:true")
        .describe(
          "Datadog RUM query string. Filter by type: '@type:session', '@type:resource', '@type:error', '@type:action', '@type:view'. " +
            "Combine with filters: '@session.has_replay:true', '@resource.status_code:>=400', '@usr.email:user@example.com', 'service:my-app'."
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
        .max(50)
        .default(20)
        .describe("Max number of RUM events to return (1-50)"),
      sort: z
        .enum(["timestamp", "-timestamp"])
        .default("-timestamp")
        .describe("Sort order: '-timestamp' (newest first) or 'timestamp' (oldest first)"),
    },
    async ({ query, from, to, limit, sort }) => {
      try {
        const response = await api.listRUMEvents({
          filterQuery: query,
          filterFrom: new Date(resolveRelativeTime(from)),
          filterTo: new Date(resolveRelativeTime(to)),
          pageLimit: limit,
          sort: sort as v2.RUMSort,
        });

        const events = response.data ?? [];

        if (events.length === 0) {
          return { content: [{ type: "text", text: "No RUM events found for the given query and time range." }] };
        }

        const formatted = events.map((event) => {
          const attrs = event.attributes ?? {};
          const inner = (attrs.attributes ?? {}) as Record<string, any>;
          const eventType = inner["type"] as string | undefined;

          const base: Record<string, unknown> = {
            eventId: event.id,
            type: eventType,
            service: attrs.service,
            timestamp: attrs.timestamp,

            sessionId: inner["session"]?.["id"],
            sessionType: inner["session"]?.["type"],
            hasReplay: inner["session"]?.["has_replay"],

            userId: inner["usr"]?.["id"],
            userName: inner["usr"]?.["name"],
            userEmail: inner["usr"]?.["email"],

            applicationId: inner["application"]?.["id"],
            applicationName: inner["application"]?.["name"],

            viewUrl: truncate(inner["view"]?.["url"], 200),
            viewName: inner["view"]?.["name"],

            browserName: inner["browser"]?.["name"],
            osName: inner["os"]?.["name"],
            deviceType: inner["device"]?.["type"],

            tags: truncateTags(attrs.tags as string[] | undefined),
          };

          if (inner["session"]?.["has_replay"] && inner["session"]?.["id"]) {
            base.replayUrl = `https://app.datadoghq.com/rum/replay/sessions/${inner["session"]["id"]}`;
          }

          if (eventType === "session") {
            base.isActive = inner["session"]?.["is_active"];
            base.errorCount = inner["session"]?.["error_count"];
            base.viewCount = inner["session"]?.["view_count"];
            base.actionCount = inner["session"]?.["action_count"];
            base.resourceCount = inner["session"]?.["resource_count"];
          }

          if (eventType === "resource") {
            base.resourceUrl = truncate(inner["resource"]?.["url"], 200);
            base.resourceMethod = inner["resource"]?.["method"];
            base.resourceStatusCode = inner["resource"]?.["status_code"];
            base.resourceDuration = inner["resource"]?.["duration"];
            base.resourceSize = inner["resource"]?.["size"];
            base.resourceType = inner["resource"]?.["type"];
          }

          if (eventType === "error") {
            base.errorMessage = truncate(inner["error"]?.["message"], 300);
            base.errorSource = inner["error"]?.["source"];
            base.errorType = inner["error"]?.["type"];
            base.errorStack = truncate(inner["error"]?.["stack"], 500);
          }

          if (eventType === "action") {
            base.actionType = inner["action"]?.["type"];
            base.actionName = inner["action"]?.["name"];
            base.actionTarget = inner["action"]?.["target"];
          }

          // Remove undefined values for cleaner output
          return Object.fromEntries(
            Object.entries(base).filter(([, v]) => v !== undefined)
          );
        });

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "RUM events", events.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to search RUM events: ${error instanceof Error ? error.message : String(error)}`,
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
