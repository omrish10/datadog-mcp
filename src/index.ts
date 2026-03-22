#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerLogsTool } from "./tools/logs.js";
import { registerMetricsTool } from "./tools/metrics.js";
import { registerMonitorsTool } from "./tools/monitors.js";
import { registerIncidentsTool } from "./tools/incidents.js";
import { registerDashboardTool } from "./tools/dashboards.js";
import { registerSpansTool } from "./tools/spans.js";
import { registerListMetricsTool } from "./tools/list_metrics.js";
import { getDatadogConfig } from "./config.js";

const config = getDatadogConfig();

const server = new McpServer({
  name: "datadog-mcp",
  version: "1.0.0",
});

registerLogsTool(server, config);
registerMetricsTool(server, config);
registerMonitorsTool(server, config);
registerIncidentsTool(server, config);
registerDashboardTool(server, config);
registerSpansTool(server, config);
registerListMetricsTool(server, config);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Datadog MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
