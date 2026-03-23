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
import { registerRumTool } from "./tools/rum.js";
import { registerTraceTool } from "./tools/trace.js";
import { registerSlosTool } from "./tools/slos.js";
import { registerHostsTool } from "./tools/hosts.js";
import { registerServicesTool } from "./tools/services.js";
import { registerEventsTool } from "./tools/events.js";
import { registerNotebooksTool } from "./tools/notebooks.js";
import { registerAuditTool } from "./tools/audit.js";
import { registerSyntheticsTool } from "./tools/synthetics.js";
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
registerRumTool(server, config);
registerTraceTool(server, config);
registerSlosTool(server, config);
registerHostsTool(server, config);
registerServicesTool(server, config);
registerEventsTool(server, config);
registerNotebooksTool(server, config);
registerAuditTool(server, config);
registerSyntheticsTool(server, config);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Datadog MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
