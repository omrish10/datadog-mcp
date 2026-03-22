import { client } from "@datadog/datadog-api-client";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface DatadogConfig {
  configuration: client.Configuration;
}

function loadEnvFile(): void {
  const envPath = process.env.DD_ENV_FILE
    ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local not found — rely on env vars
  }
}

export function getDatadogConfig(): DatadogConfig {
  loadEnvFile();

  const apiKey = process.env.DD_API_KEY ?? process.env.API_KEY_SECRET;
  const appKey = process.env.DD_APP_KEY ?? process.env.APPLICATION_KEY_SECRET;

  if (!apiKey) {
    throw new Error("DD_API_KEY environment variable is required");
  }
  if (!appKey) {
    throw new Error("DD_APP_KEY environment variable is required");
  }

  const configParams: Record<string, unknown> = {
    authMethods: {
      apiKeyAuth: apiKey,
      appKeyAuth: appKey,
    },
  };

  // Support custom Datadog site (e.g. datadoghq.eu, us3.datadoghq.com)
  const site = process.env.DD_SITE;
  if (site) {
    configParams.baseServer = new client.BaseServerConfiguration(
      `https://api.${site}`,
      {}
    );
  }

  const configuration = client.createConfiguration(
    configParams as Parameters<typeof client.createConfiguration>[0]
  );

  return { configuration };
}
