import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncate, formatToolOutput } from "./format.js";

export function registerDashboardTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.DashboardsApi(config.configuration);

  server.tool(
    "get_dashboard",
    "Get a Datadog dashboard by ID, or list all dashboards when no ID is provided. Returns widget definitions, layout, and template variables.",
    {
      dashboardId: z
        .string()
        .optional()
        .describe("Dashboard ID to fetch. Omit to list all dashboards."),
    },
    async ({ dashboardId }) => {
      try {
        if (!dashboardId) {
          const list = await api.listDashboards();
          const dashboards = list.dashboards ?? [];

          const formatted = dashboards.slice(0, 50).map((d) => ({
            id: d.id,
            title: d.title,
            description: d.description?.substring(0, 100),
            layoutType: d.layoutType,
            url: d.url,
            createdAt: d.createdAt,
            modifiedAt: d.modifiedAt,
            authorHandle: d.authorHandle,
          }));

          return {
            content: [
              {
                type: "text",
                text: formatToolOutput(formatted, "dashboards", dashboards.length),
              },
            ],
          };
        }

        const dashboard = await api.getDashboard({ dashboardId });

        const formatted = {
          id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          layoutType: dashboard.layoutType,
          url: dashboard.url,
          templateVariables: dashboard.templateVariables,
          widgetCount: dashboard.widgets?.length ?? 0,
          widgets: dashboard.widgets?.slice(0, 30).map((w) => ({
            id: w.id,
            definition: truncate(JSON.stringify(w.definition), 500),
          })),
        };

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "dashboard"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get dashboard: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
