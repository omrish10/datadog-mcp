import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { formatToolOutput } from "./format.js";

export function registerIncidentsTool(server: McpServer, config: DatadogConfig) {
  const api = new v2.IncidentsApi(config.configuration);

  server.tool(
    "search_incidents",
    "Search Datadog incidents by query. Returns incident title, status, severity, and timeline.",
    {
      query: z
        .string()
        .default("state:(active OR stable)")
        .describe("Incident search query (e.g. 'state:active', 'severity:SEV-1', 'state:(active OR stable)')"),
      pageSize: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Number of incidents to return (1-50)"),
      sort: z
        .enum(["created", "-created", "modified", "-modified"])
        .default("-created")
        .describe("Sort order"),
    },
    async ({ query, pageSize, sort }) => {
      try {
        const response = await api.searchIncidents({
          query,
          pageSize,
          sort: sort as v2.IncidentSearchSortOrder,
        });

        const incidents = response.data?.attributes?.incidents ?? [];

        if (incidents.length === 0) {
          return { content: [{ type: "text", text: "No incidents found matching the query." }] };
        }

        const formatted = incidents.map((inc) => {
          const data = inc.data;
          const attrs = data?.attributes as Record<string, unknown> | undefined;
          return {
            id: data?.id,
            title: attrs?.title,
            state: attrs?.state,
            severity: attrs?.severity,
            created: attrs?.created,
            modified: attrs?.modified,
            resolved: attrs?.resolved,
            customerImpacted: attrs?.customerImpacted,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "incidents", incidents.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to search incidents: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
