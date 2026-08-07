#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createApplication } from "./app.js";
import { errorPayload } from "./errors.js";
import { buildMcpServer } from "./server.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
  const app = createApplication();

  if (command === "serve") {
    const handle = serveStdio(() => buildMcpServer(app), {
      onerror: (error) => process.stderr.write(`[substack-insights] ${error.message}\n`),
    });
    const shutdown = async () => {
      await handle.close();
      app.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  try {
    switch (command) {
      case "status":
        print(app.content.status());
        break;
      case "sync": {
        print(await app.content.sync());
        break;
      }
      case "help":
      case "--help":
      case "-h":
        process.stdout.write(helpText());
        break;
      default:
        process.stderr.write(`Unknown command: ${command}\n\n${helpText()}`);
        process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    app.close();
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function helpText(): string {
  return `Substack Insights MCP

Usage:
  substack-insights serve
  substack-insights status
  substack-insights sync

Environment:
  SUBSTACK_PUBLICATION_URL      Publication origin, for example https://example.substack.com
  SUBSTACK_INSIGHTS_DB_PATH     SQLite path (default: ./data/substack-insights.sqlite)
`;
}

void main();
