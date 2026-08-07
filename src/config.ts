import "dotenv/config";

import { resolve } from "node:path";

import { SubstackInsightsError } from "./errors.js";

export interface AppConfig {
  dbPath: string;
  publicationUrl: string | null;
}

export function normalizePublicationUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SubstackInsightsError(
      "invalid_publication_url",
      "SUBSTACK_PUBLICATION_URL must be a complete HTTPS URL.",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new SubstackInsightsError(
      "invalid_publication_url",
      "The publication URL must use HTTPS.",
    );
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPath = env.SUBSTACK_INSIGHTS_DB_PATH?.trim() || "data/substack-insights.sqlite";
  const publicationValue = env.SUBSTACK_PUBLICATION_URL?.trim();

  return {
    dbPath: rawPath === ":memory:" ? rawPath : resolve(process.cwd(), rawPath),
    publicationUrl: publicationValue ? normalizePublicationUrl(publicationValue) : null,
  };
}

export function requirePublicationUrl(config: AppConfig): string {
  if (!config.publicationUrl) {
    throw new SubstackInsightsError(
      "publication_not_configured",
      "Set SUBSTACK_PUBLICATION_URL before syncing or creating local content.",
    );
  }
  return config.publicationUrl;
}
