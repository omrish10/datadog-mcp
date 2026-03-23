import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncateTags, formatToolOutput } from "./format.js";

export function registerSlosTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.ServiceLevelObjectivesApi(config.configuration);

  server.tool(
    "list_slos",
    "List Datadog SLOs or get detailed SLO history. Without slo_id, lists SLOs filtered by name/tags. With slo_id, returns SLO status history including SLI value and error budget.",
    {
      query: z
        .string()
        .optional()
        .describe("Filter SLOs by name"),
      tags: z
        .string()
        .optional()
        .describe("Comma-separated tags to filter by"),
      slo_id: z
        .string()
        .optional()
        .describe("Specific SLO ID to get history for"),
      from: z
        .string()
        .default("now-7d")
        .describe("History start time (only with slo_id)"),
      to: z
        .string()
        .default("now")
        .describe("History end time (only with slo_id)"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(25)
        .describe("Max SLOs to return"),
    },
    async ({ query, tags, slo_id, from, to, limit }) => {
      try {
        if (slo_id) {
          const fromTs = Math.floor(
            new Date(resolveRelativeTime(from)).getTime() / 1000
          );
          const toTs = Math.floor(
            new Date(resolveRelativeTime(to)).getTime() / 1000
          );

          const response = await api.getSLOHistory({
            sloId: slo_id,
            fromTs,
            toTs,
          });

          const data = response.data;
          if (!data) {
            return {
              content: [{ type: "text" as const, text: "No SLOs found matching the given criteria." }],
            };
          }

          const formatted = {
            name: (data as any).name,
            sliValue: (data as any).overall?.sliValue,
            errorBudgetRemaining: (data as any).overall?.errorBudgetRemaining,
            target: (data as any).overall?.target,
            timeframe: (data as any).overall?.timeframe,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: formatToolOutput(formatted, "SLO history", 1),
              },
            ],
          };
        }

        const response = await api.listSLOs({
          query,
          tagsQuery: tags,
          limit,
          offset: 0,
        });

        const slos = response.data ?? [];

        if (slos.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No SLOs found matching the given criteria." }],
          };
        }

        const formatted = slos.map((slo) => ({
          name: slo.name,
          id: slo.id,
          type: slo.type,
          tags: truncateTags(slo.tags),
          thresholds: (slo.thresholds ?? []).map((t) => ({
            target: t.target,
            timeframe: t.timeframe,
          })),
          description: slo.description,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: formatToolOutput(formatted, "SLOs", slos.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to list SLOs: ${error instanceof Error ? error.message : String(error)}`,
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
