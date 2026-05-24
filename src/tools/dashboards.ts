import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncate, formatToolOutput } from "./format.js";

const LAYOUT_TYPES = ["ordered", "free"] as const;
const REFLOW_TYPES = ["auto", "fixed"] as const;

const WIDGET_TYPES = [
  "timeseries", "query_value", "toplist", "heatmap", "distribution",
  "change", "hostmap", "scatterplot", "treemap", "sunburst", "geomap",
  "query_table", "alert_graph", "alert_value", "check_status",
  "service_summary", "slo", "slo_list", "topology_map", "trace_service",
  "manage_status", "event_stream", "event_timeline", "log_stream",
  "list_stream", "free_text", "iframe", "image", "note", "group",
  "powerpack", "split_group", "run_workflow",
] as const;

interface WidgetInput {
  type: (typeof WIDGET_TYPES)[number];
  definition: Record<string, unknown>;
  layout?: { x: number; y: number; width: number; height: number };
  id?: number;
}

function buildWidgets(widgets: WidgetInput[]) {
  return widgets.map((w) => {
    const widget: Record<string, unknown> = {
      definition: { type: w.type, ...w.definition },
    };
    if (w.layout) widget.layout = w.layout;
    if (w.id !== undefined) widget.id = w.id;
    return widget;
  });
}

function dashboardUrl(site: string, id: string | undefined): string {
  if (!id) return "";
  const parts = site.split(".");
  const host = parts.length > 2 ? site : `app.${site}`;
  return `https://${host}/dashboard/${id}`;
}

export function registerDashboardTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.DashboardsApi(config.configuration);

  // ── get_dashboard ─────────────────────────────────────────────────────

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

  // ── create_dashboard ──────────────────────────────────────────────────

  server.tool(
    "create_dashboard",
    "Create a new Datadog dashboard.\n\nWidget examples:\n- Timeseries: {type:'timeseries', definition:{title:'CPU', requests:[{q:'avg:system.cpu.user{*}', display_type:'line'}]}}\n- Query value: {type:'query_value', definition:{title:'Errors', requests:[{q:'sum:errors{*}.as_count()', aggregator:'sum'}]}}\n- Toplist: {type:'toplist', definition:{requests:[{q:'top(avg:system.cpu.user{*} by {host}, 10, \"mean\", \"desc\")'}]}}\n- Note: {type:'note', definition:{content:'# Section heading'}}\n\nLayout types:\n- 'ordered' (recommended): widgets stack top-to-bottom; widget layouts optional\n- 'free': absolute positioning; every widget MUST include a 'layout' {x,y,width,height}\n\nThe 'definition.type' field is auto-injected from the widget type — you don't need to include it.",
    {
      title: z.string().describe("Dashboard title"),
      layout_type: z
        .enum(LAYOUT_TYPES)
        .default("ordered")
        .describe("'ordered' for a stacked layout, 'free' for absolute positioning"),
      description: z.string().optional().describe("Dashboard description"),
      widgets: z
        .array(
          z.object({
            type: z.enum(WIDGET_TYPES).describe("Widget type"),
            definition: z
              .record(z.unknown())
              .describe("Widget definition body. Must contain the fields expected by the Datadog widget type (e.g. 'requests', 'title'). The 'type' field is auto-injected from the widget type."),
            layout: z
              .object({
                x: z.number().int().min(0),
                y: z.number().int().min(0),
                width: z.number().int().min(1),
                height: z.number().int().min(1),
              })
              .optional()
              .describe("Required for 'free' layouts; optional for 'ordered'"),
          })
        )
        .min(1)
        .describe("Widgets to display on the dashboard"),
      template_variables: z
        .array(
          z.object({
            name: z.string(),
            prefix: z.string().optional(),
            default: z.string().optional(),
            available_values: z.array(z.string()).optional(),
          })
        )
        .optional()
        .describe("Template variables for the dashboard"),
      notify_list: z
        .array(z.string())
        .optional()
        .describe("Handles of users to notify on changes"),
      tags: z.array(z.string()).optional().describe("Team-ownership tags"),
      reflow_type: z
        .enum(REFLOW_TYPES)
        .optional()
        .describe("For 'ordered' layouts: 'fixed' expects widget layouts, 'auto' ignores them"),
    },
    async ({
      title, layout_type, description, widgets, template_variables, notify_list, tags, reflow_type,
    }) => {
      try {
        const body = {
          title,
          layoutType: layout_type,
          widgets: buildWidgets(widgets),
          ...(description && { description }),
          ...(template_variables && {
            templateVariables: template_variables.map((tv) => ({
              name: tv.name,
              ...(tv.prefix && { prefix: tv.prefix }),
              ...(tv.default && { default: tv.default }),
              ...(tv.available_values && { availableValues: tv.available_values }),
            })),
          }),
          ...(notify_list && { notifyList: notify_list }),
          ...(tags && { tags }),
          ...(reflow_type && { reflowType: reflow_type }),
        } as unknown as v1.Dashboard;

        const dashboard = await api.createDashboard({ body });

        const formatted = {
          id: dashboard.id,
          title: dashboard.title,
          layoutType: dashboard.layoutType,
          url: dashboard.url ?? dashboardUrl(config.site, dashboard.id),
          widgetCount: dashboard.widgets?.length ?? 0,
          createdAt: dashboard.createdAt,
        };

        return {
          content: [{ type: "text", text: formatToolOutput(formatted, "dashboard") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create dashboard: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── update_dashboard ──────────────────────────────────────────────────

  server.tool(
    "update_dashboard",
    "Update an existing Datadog dashboard. Replaces the full dashboard definition — call get_dashboard first to fetch current widgets and their IDs. Widgets with an id update existing ones; widgets without id create new ones; existing widgets omitted from the list are deleted.",
    {
      dashboard_id: z.string().describe("ID of the dashboard to update"),
      title: z.string().describe("Dashboard title"),
      layout_type: z
        .enum(LAYOUT_TYPES)
        .describe("'ordered' for a stacked layout, 'free' for absolute positioning"),
      description: z.string().optional().describe("Dashboard description"),
      widgets: z
        .array(
          z.object({
            type: z.enum(WIDGET_TYPES).describe("Widget type"),
            definition: z
              .record(z.unknown())
              .describe("Widget definition body. The 'type' field is auto-injected."),
            layout: z
              .object({
                x: z.number().int().min(0),
                y: z.number().int().min(0),
                width: z.number().int().min(1),
                height: z.number().int().min(1),
              })
              .optional()
              .describe("Required for 'free' layouts"),
            id: z
              .number()
              .optional()
              .describe("Existing widget ID from get_dashboard — include to update, omit to create new"),
          })
        )
        .min(1)
        .describe("Complete list of widgets for the dashboard"),
      template_variables: z
        .array(
          z.object({
            name: z.string(),
            prefix: z.string().optional(),
            default: z.string().optional(),
            available_values: z.array(z.string()).optional(),
          })
        )
        .optional(),
      notify_list: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      reflow_type: z.enum(REFLOW_TYPES).optional(),
    },
    async ({
      dashboard_id, title, layout_type, description, widgets,
      template_variables, notify_list, tags, reflow_type,
    }) => {
      try {
        const body = {
          title,
          layoutType: layout_type,
          widgets: buildWidgets(widgets),
          ...(description && { description }),
          ...(template_variables && {
            templateVariables: template_variables.map((tv) => ({
              name: tv.name,
              ...(tv.prefix && { prefix: tv.prefix }),
              ...(tv.default && { default: tv.default }),
              ...(tv.available_values && { availableValues: tv.available_values }),
            })),
          }),
          ...(notify_list && { notifyList: notify_list }),
          ...(tags && { tags }),
          ...(reflow_type && { reflowType: reflow_type }),
        } as unknown as v1.Dashboard;

        const dashboard = await api.updateDashboard({ dashboardId: dashboard_id, body });

        const formatted = {
          id: dashboard.id,
          title: dashboard.title,
          layoutType: dashboard.layoutType,
          url: dashboard.url ?? dashboardUrl(config.site, dashboard.id),
          widgetCount: dashboard.widgets?.length ?? 0,
          modifiedAt: dashboard.modifiedAt,
        };

        return {
          content: [{ type: "text", text: formatToolOutput(formatted, "dashboard") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update dashboard: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
