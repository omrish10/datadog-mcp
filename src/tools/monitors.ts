import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncateTags, formatToolOutput } from "./format.js";

export function registerMonitorsTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.MonitorsApi(config.configuration);

  server.tool(
    "list_monitors",
    "List or search Datadog monitors. Returns monitor name, status, type, and tags. Filter by name, tags, or monitor type.",
    {
      name: z
        .string()
        .optional()
        .describe("Filter monitors by name (substring match)"),
      tags: z
        .string()
        .optional()
        .describe("Comma-separated monitor tags to filter by (e.g. 'team:backend,env:prod')"),
      monitorTags: z
        .string()
        .optional()
        .describe("Comma-separated monitor tags (monitor-level, not metric tags)"),
      pageSize: z
        .number()
        .min(1)
        .max(100)
        .default(25)
        .describe("Number of monitors to return (1-100)"),
      page: z
        .number()
        .default(0)
        .describe("Page number for pagination (0-based)"),
    },
    async ({ name, tags, monitorTags, pageSize, page }) => {
      try {
        const params: v1.MonitorsApiListMonitorsRequest = {
          pageSize,
          page,
          groupStates: "alert,warn,no data",
        };

        if (name) params.name = name;
        if (tags) params.tags = tags;
        if (monitorTags) params.monitorTags = monitorTags;

        const monitors = await api.listMonitors(params);

        if (!monitors || monitors.length === 0) {
          return { content: [{ type: "text", text: "No monitors found matching the criteria." }] };
        }

        const formatted = monitors.map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          overallState: m.overallState,
          message: m.message?.substring(0, 200),
          tags: truncateTags(m.tags),
          created: m.created,
          modified: m.modified,
        }));

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "monitors", monitors.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list monitors: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
