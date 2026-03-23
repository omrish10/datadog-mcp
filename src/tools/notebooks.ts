import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncate, formatToolOutput } from "./format.js";

export function registerNotebooksTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.NotebooksApi(config.configuration);

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
}
