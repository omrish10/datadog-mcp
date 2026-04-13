import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncate, formatToolOutput } from "./format.js";

const LIVE_SPANS = [
  "1m", "5m", "10m", "15m", "30m",
  "1h", "4h", "1d", "2d", "1w",
  "1mo", "3mo", "6mo", "1y",
  "week_to_date", "month_to_date",
] as const;

const CELL_TYPES = [
  "markdown", "timeseries", "toplist", "heatmap", "distribution", "log_stream",
] as const;

const METADATA_TYPES = [
  "postmortem", "runbook", "investigation", "documentation", "report",
] as const;

const GRAPH_SIZES = ["xs", "s", "m", "l", "xl"] as const;

interface CellInput {
  type: (typeof CELL_TYPES)[number];
  content?: string;
  definition?: Record<string, unknown>;
  graph_size?: (typeof GRAPH_SIZES)[number];
  id?: string;
}

function buildCells(cells: CellInput[]) {
  return cells.map((cell) => {
    const base: Record<string, unknown> = { type: "notebook_cells" };

    if (cell.type === "markdown") {
      base.attributes = {
        definition: { type: "markdown", text: cell.content ?? "" },
      };
    } else {
      const def = { type: cell.type, ...(cell.definition ?? {}) };
      const attrs: Record<string, unknown> = {
        definition: def,
      };
      if (cell.graph_size) {
        attrs.graphSize = cell.graph_size;
      }
      base.attributes = attrs;
    }

    if (cell.id) {
      base.id = cell.id;
    }

    return base;
  });
}

function notebookUrl(site: string, id: number | undefined): string {
  if (!id) return "";
  const parts = site.split(".");
  const host = parts.length > 2 ? site : `app.${site}`;
  return `https://${host}/notebook/${id}`;
}

export function registerNotebooksTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.NotebooksApi(config.configuration);

  // ── get_notebook ──────────────────────────────────────────────────────

  server.tool(
    "get_notebook",
    "List Datadog notebooks or get a specific notebook's contents. Notebooks contain investigation runbooks, postmortem data, and saved analyses.",
    {
      notebook_id: z
        .number()
        .optional()
        .describe("Specific notebook ID to fetch with full cell contents"),
      query: z
        .string()
        .optional()
        .describe("Search notebooks by name"),
      count: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of notebooks to return (when listing)"),
    },
    async ({ notebook_id, query, count }) => {
      try {
        if (notebook_id !== undefined) {
          const response = await api.getNotebook({ notebookId: notebook_id });
          const nb = response.data;
          if (!nb) {
            return { content: [{ type: "text", text: `Notebook ${notebook_id} not found.` }] };
          }
          const attrs = nb.attributes;

          const formatted = {
            id: nb.id,
            name: attrs.name,
            author: attrs.author?.handle,
            cells: attrs.cells.map((cell) => ({
              id: cell.id,
              type: cell.type,
              content: truncate(JSON.stringify(cell.attributes), 500),
            })),
            created: attrs.created,
            modified: attrs.modified,
            status: attrs.status,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: formatToolOutput(formatted, "notebook"),
              },
            ],
          };
        }

        const response = await api.listNotebooks({ query, count });
        const notebooks = response.data ?? [];

        if (notebooks.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No notebooks found matching the given criteria." }],
          };
        }

        const formatted = notebooks.map((nb) => {
          const attrs = nb.attributes;
          return {
            id: nb.id,
            name: attrs.name,
            author: attrs.author?.handle,
            created: attrs.created,
            modified: attrs.modified,
            status: attrs.status,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatToolOutput(formatted, "notebooks", notebooks.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get notebooks: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── create_notebook ───────────────────────────────────────────────────

  server.tool(
    "create_notebook",
    "Create a new Datadog notebook. Notebooks support markdown and graph cells.\n\nCell examples:\n- Markdown: {type:'markdown', content:'# Title'}\n- Timeseries: {type:'timeseries', definition:{requests:[{q:'avg:system.cpu.user{*}'}]}, graph_size:'m'}\n- Toplist: {type:'toplist', definition:{requests:[{q:'top(avg:system.cpu.user{*} by {host}, 10, \"mean\", \"desc\")'}]}}\n- Log stream: {type:'log_stream', definition:{indexes:['main'], query:'service:web', columns:['host','service','content']}}\n\nThe 'definition.type' field is auto-injected from the cell type — you don't need to include it.",
    {
      name: z.string().describe("Notebook title"),
      cells: z
        .array(
          z.object({
            type: z.enum(CELL_TYPES).describe("Cell type: 'markdown' for text, or a graph type"),
            content: z.string().optional().describe("Markdown text (required for markdown cells)"),
            definition: z
              .record(z.unknown())
              .optional()
              .describe("Widget definition object (required for graph cells). Must contain the fields expected by the Datadog widget type — e.g. {requests:[{q:'metric.query{tags}'}]} for timeseries/toplist/heatmap/distribution, or {indexes:['main'], query:'search query'} for log_stream. The 'type' field is auto-injected from the cell type."),
            graph_size: z.enum(GRAPH_SIZES).optional().describe("Graph display size"),
          })
        )
        .min(1)
        .describe("Notebook cells"),
      time_range: z
        .enum(LIVE_SPANS)
        .default("1h")
        .describe("Global time range for the notebook"),
      metadata_type: z
        .enum(METADATA_TYPES)
        .optional()
        .describe("Notebook type for categorization"),
    },
    async ({ name, cells, time_range, metadata_type }) => {
      try {
        const body = {
          data: {
            type: "notebooks",
            attributes: {
              name,
              cells: buildCells(cells),
              time: { liveSpan: time_range },
              ...(metadata_type && { metadata: { type: metadata_type } }),
              status: "published",
            },
          },
        } as unknown as v1.NotebookCreateRequest;

        const response = await api.createNotebook({ body });
        const nb = response.data;

        const formatted = {
          id: nb?.id,
          name: nb?.attributes.name,
          status: nb?.attributes.status,
          url: notebookUrl(config.site, nb?.id),
          created: nb?.attributes.created,
          cellCount: nb?.attributes.cells.length,
        };

        return {
          content: [{ type: "text" as const, text: formatToolOutput(formatted, "notebook") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to create notebook: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── update_notebook ───────────────────────────────────────────────────

  server.tool(
    "update_notebook",
    "Update an existing Datadog notebook. Replaces the full notebook content — use get_notebook first to fetch current cells and their IDs. Cells with an id update existing cells; cells without id create new cells; existing cells omitted from the list are deleted.",
    {
      notebook_id: z.number().describe("ID of the notebook to update"),
      name: z.string().describe("Notebook title"),
      cells: z
        .array(
          z.object({
            type: z.enum(CELL_TYPES).describe("Cell type: 'markdown' for text, or a graph type"),
            content: z.string().optional().describe("Markdown text (required for markdown cells)"),
            definition: z
              .record(z.unknown())
              .optional()
              .describe("Widget definition object (required for graph cells). Must contain the fields expected by the Datadog widget type — e.g. {requests:[{q:'metric.query{tags}'}]} for timeseries/toplist/heatmap/distribution, or {indexes:['main'], query:'search query'} for log_stream. The 'type' field is auto-injected from the cell type."),
            graph_size: z.enum(GRAPH_SIZES).optional().describe("Graph display size"),
            id: z
              .string()
              .optional()
              .describe("Existing cell ID from get_notebook — include to update, omit to create new"),
          })
        )
        .min(1)
        .describe("Complete list of cells for the notebook"),
      time_range: z
        .enum(LIVE_SPANS)
        .default("1h")
        .describe("Global time range for the notebook"),
      metadata_type: z
        .enum(METADATA_TYPES)
        .optional()
        .describe("Notebook type for categorization"),
    },
    async ({ notebook_id, name, cells, time_range, metadata_type }) => {
      try {
        const body = {
          data: {
            type: "notebooks",
            attributes: {
              name,
              cells: buildCells(cells),
              time: { liveSpan: time_range },
              ...(metadata_type && { metadata: { type: metadata_type } }),
              status: "published",
            },
          },
        } as unknown as v1.NotebookUpdateRequest;

        const response = await api.updateNotebook({ notebookId: notebook_id, body });
        const nb = response.data;

        const formatted = {
          id: nb?.id,
          name: nb?.attributes.name,
          status: nb?.attributes.status,
          url: notebookUrl(config.site, nb?.id),
          modified: nb?.attributes.modified,
          cellCount: nb?.attributes.cells.length,
        };

        return {
          content: [{ type: "text" as const, text: formatToolOutput(formatted, "notebook") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to update notebook: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── delete_notebook ───────────────────────────────────────────────────

  server.tool(
    "delete_notebook",
    "Delete a Datadog notebook by ID. This action is irreversible.",
    {
      notebook_id: z.number().describe("ID of the notebook to delete"),
    },
    async ({ notebook_id }) => {
      try {
        await api.deleteNotebook({ notebookId: notebook_id });
        return {
          content: [{ type: "text" as const, text: `Notebook ${notebook_id} deleted successfully.` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to delete notebook: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
