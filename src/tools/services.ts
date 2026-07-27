import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v2 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncateTags, formatToolOutput } from "./format.js";

/** Sentinel for "don't filter by kind" — the API omits the filter entirely. */
const ALL_KINDS = "all";

export function registerServicesTool(server: McpServer, config: DatadogConfig) {
  const api = new v2.SoftwareCatalogApi(config.configuration);

  server.registerTool(
    "list_services",
    {
      title: "List Services",
      description:
        "List entities from the Datadog Software Catalog — services by default, plus systems, datastores, queues, and APIs. " +
        "Returns ownership, description, and tags. Set include_schema to also return contacts and links from the entity definition.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        kind: z
          .string()
          .default("service")
          .describe(
            "Entity kind to list: 'service' (default), 'system', 'datastore', 'queue', 'api'. Pass 'all' to list every kind."
          ),
        name: z.string().optional().describe("Filter entities by name"),
        owner: z.string().optional().describe("Filter entities by owning team"),
        include_schema: z
          .boolean()
          .default(false)
          .describe("Include contacts and links from the full entity definition"),
        include_discovered: z
          .boolean()
          .default(true)
          .describe(
            "Include entities auto-discovered from APM/telemetry, not just ones registered via entity definitions. Set false to list only registered entities."
          ),
        page_size: z
          .number()
          .min(1)
          .max(100)
          .default(20)
          .describe("Number of entities per page"),
        page_number: z.number().min(0).default(0).describe("Page number (0-based)"),
      },
    },
    async ({ kind, name, owner, include_schema, include_discovered, page_size, page_number }) => {
      try {
        const response = await api.listCatalogEntity({
          pageOffset: page_number * page_size,
          pageLimit: page_size,
          includeDiscovered: include_discovered,
          ...(kind !== ALL_KINDS && { filterKind: kind }),
          ...(name && { filterName: name }),
          ...(owner && { filterOwner: owner }),
          ...(include_schema && { include: "schema" as v2.IncludeType }),
        });

        const entities = response.data ?? [];

        if (entities.length === 0) {
          return {
            content: [
              { type: "text", text: "No entities found in the Software Catalog." },
            ],
          };
        }

        const schemasById = include_schema ? indexSchemas(response.included) : new Map();

        const formatted = entities.map((entity) => {
          const attrs = entity.attributes ?? {};
          const metadata = schemasById.get(entity.id ?? "");

          return {
            name: attrs.name ?? entity.id,
            kind: attrs.kind,
            displayName: attrs.displayName,
            namespace: attrs.namespace,
            owner: attrs.owner,
            description: attrs.description,
            tags: truncateTags(attrs.tags),
            ...(metadata && {
              contacts: metadata.contacts,
              links: metadata.links,
            }),
          };
        });

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(
                formatted,
                "catalog entities",
                response.meta?.count ?? entities.length
              ),
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

interface SchemaMetadata {
  contacts?: unknown;
  links?: unknown;
}

/**
 * Index the `included` schema documents by entity ID.
 *
 * Contacts and links live in the v3 entity definition rather than on the
 * entity resource itself, so they are only available when the caller opts
 * into `include=schema`.
 */
function indexSchemas(
  included: v2.ListEntityCatalogResponseIncludedItem[] | undefined
): Map<string, SchemaMetadata> {
  const byId = new Map<string, SchemaMetadata>();

  for (const item of included ?? []) {
    const entry = item as {
      id?: string;
      type?: string;
      attributes?: { schema?: Record<string, any> };
    };

    if (entry.type !== "schema" || !entry.id) continue;

    const metadata = entry.attributes?.schema?.metadata;
    if (!metadata) continue;

    byId.set(entry.id, {
      contacts: metadata.contacts,
      links: metadata.links,
    });
  }

  return byId;
}
