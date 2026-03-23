import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncateTags, formatToolOutput } from "./format.js";

export function registerHostsTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.HostsApi(config.configuration);

  server.tool(
    "list_hosts",
    "List and search Datadog infrastructure hosts. Filter by name, alias, or tag. Returns host metadata including apps, tags, and platform info.",
    {
      filter: z
        .string()
        .optional()
        .describe("Filter hosts by name, alias, or tag"),
      sort_field: z
        .string()
        .optional()
        .describe("Field to sort by"),
      sort_dir: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction"),
      count: z
        .number()
        .min(1)
        .max(1000)
        .default(50)
        .describe("Number of hosts to return"),
      include_metadata: z
        .boolean()
        .default(true)
        .describe("Include agent version, platform, processor info"),
    },
    async ({ filter, sort_field, sort_dir, count, include_metadata }) => {
      try {
        const response = await api.listHosts({
          filter,
          sortField: sort_field,
          sortDir: sort_dir,
          count,
          includeHostsMetadata: include_metadata,
          includeMutedHostsData: true,
        });

        const hosts = response.hostList ?? [];

        if (hosts.length === 0) {
          return { content: [{ type: "text", text: "No hosts found matching the given filter." }] };
        }

        const formatted = hosts.map((host) => {
          const result: Record<string, unknown> = {
            hostName: host.hostName,
            aliases: host.aliases,
            apps: host.apps,
            tags: truncateTags(host.tagsBySource ? Object.values(host.tagsBySource).flat() : undefined),
            isMuted: host.isMuted,
            lastReportedTime: host.lastReportedTime,
            sources: host.sources,
          };

          if (include_metadata && host.meta) {
            result.meta = {
              agentVersion: host.meta.agentVersion,
              platform: host.meta.platform,
              processor: host.meta.processor,
            };
          }

          return result;
        });

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "hosts", response.totalMatching ?? hosts.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list hosts: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
