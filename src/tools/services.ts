import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncateTags, formatToolOutput } from "./format.js";

export function registerServicesTool(server: McpServer, config: DatadogConfig) {
  const api = new v2.ServiceDefinitionApi(config.configuration);

  server.tool(
    "list_services",
    "List services from the Datadog Service Catalog. Returns service definitions including team ownership, contacts, and links.",
    {
      page_size: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of services per page"),
      page_number: z
        .number()
        .default(0)
        .describe("Page number (0-based)"),
    },
    async ({ page_size, page_number }) => {
      try {
        const response = await api.listServiceDefinitions({
          pageSize: page_size,
          pageNumber: page_number,
        });

        const data = response.data ?? [];

        if (data.length === 0) {
          return { content: [{ type: "text", text: "No services found in the Service Catalog." }] };
        }

        const formatted = data.map((item) => {
          const schema = item.attributes?.schema as Record<string, any> | undefined;

          return {
            serviceName: schema?.ddService ?? item.id,
            schemaVersion: schema?.schemaVersion,
            description: schema?.description,
            team: schema?.team,
            contacts: schema?.contacts,
            links: schema?.links,
            tags: truncateTags(schema?.tags as string[] | undefined),
          };
        });

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "services", data.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list services: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
