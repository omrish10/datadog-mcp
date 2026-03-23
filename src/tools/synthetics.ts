import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { v1 } from "@datadog/datadog-api-client";
import { z } from "zod";
import type { DatadogConfig } from "../config.js";
import { truncateTags, formatToolOutput } from "./format.js";

export function registerSyntheticsTool(server: McpServer, config: DatadogConfig) {
  const api = new v1.SyntheticsApi(config.configuration);

  server.tool(
    "list_synthetics",
    "List Datadog Synthetic tests or get latest results for a specific test. Covers API tests, browser tests, and multistep tests.",
    {
      test_id: z
        .string()
        .optional()
        .describe("Public test ID to fetch latest results for"),
      query: z
        .string()
        .optional()
        .describe("Search text to filter tests by name"),
      page_size: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of tests to return"),
    },
    async ({ test_id, query, page_size }) => {
      try {
        if (test_id) {
          return await getTestResults(api, test_id);
        }

        let response;
        if (query) {
          response = await api.searchTests({ text: query, count: page_size });
        } else {
          response = await api.listTests({ pageSize: page_size, pageNumber: 0 });
        }

        const tests = response.tests ?? [];

        if (tests.length === 0) {
          return { content: [{ type: "text", text: "No synthetic tests found." }] };
        }

        const formatted = tests.map((test) => ({
          publicId: test.publicId,
          name: test.name,
          type: test.type,
          subtype: test.subtype,
          status: test.status,
          locations: truncateTags(test.locations as string[] | undefined, 5),
          tags: truncateTags(test.tags),
          monitorId: test.monitorId,
        }));

        return {
          content: [
            {
              type: "text",
              text: formatToolOutput(formatted, "synthetic tests", tests.length),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list synthetic tests: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

async function getTestResults(api: v1.SyntheticsApi, testId: string) {
  try {
    // Try API test first
    let testName: string | undefined;
    let testType: string;
    let testStatus: string | undefined;
    let results: unknown[];

    try {
      const apiTest = await api.getAPITest({ publicId: testId });
      testName = apiTest.name;
      testType = String(apiTest.type ?? "api");
      testStatus = String(apiTest.status ?? "unknown");

      const latestResults = await api.getAPITestLatestResults({ publicId: testId });
      results = (latestResults.results ?? []).map((r) => ({
        checkTime: r.checkTime,
        location: r.probeDc,
        status: r.status,
        resultId: r.resultId,
      }));
    } catch {
      // API test fetch failed — likely a browser test
      const browserTest = await api.getBrowserTest({ publicId: testId });
      testName = browserTest.name;
      testType = String(browserTest.type ?? "browser");
      testStatus = String(browserTest.status ?? "unknown");

      const latestResults = await api.getBrowserTestLatestResults({ publicId: testId });
      results = (latestResults.results ?? []).map((r) => ({
        checkTime: r.checkTime,
        location: r.probeDc,
        status: r.status,
        resultId: r.resultId,
      }));
    }

    const output = {
      testId,
      name: testName,
      type: testType,
      status: testStatus,
      results,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: formatToolOutput(output, "results", results.length),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to get test results for ${testId}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
