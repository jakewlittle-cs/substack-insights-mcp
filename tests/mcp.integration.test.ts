import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

describe("MCP stdio server", () => {
  it("negotiates, advertises the full tool surface, and answers a tool call", async () => {
    const client = new Client({ name: "substack-insights-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("node_modules/tsx/dist/cli.mjs"), "src/cli.ts", "serve"],
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        SUBSTACK_INSIGHTS_DB_PATH: ":memory:",
        SUBSTACK_PUBLICATION_URL: "https://example.substack.com",
      },
      stderr: "pipe",
    });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(12);
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "connection_status",
          "sync_publication",
          "list_post_versions",
          "list_audit_events",
          "analyze_content_patterns",
          "record_metric_snapshot",
          "create_local_draft",
        ]),
      );

      const result = await client.callTool({ name: "connection_status", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        publicationUrl: "https://example.substack.com",
        publicationInitialized: false,
        ingestion: "public_rss",
        credentialsRequired: false,
      });

      const draft = await client.callTool({
        name: "create_local_draft",
        arguments: { title: "Measured post", markdown: "A clear local snapshot." },
      });
      expect(draft.isError).not.toBe(true);
      const postId = (draft.structuredContent as { id: string }).id;

      const snapshot = await client.callTool({
        name: "record_metric_snapshot",
        arguments: {
          identifier: postId,
          sent: 1_000,
          delivered: 980,
          opens: 490,
          openRate: 0.5,
          views: 1_500,
          freeSubscriptions: 25,
          paidSubscriptions: 5,
        },
      });
      expect(snapshot.isError).not.toBe(true);
      expect(snapshot.structuredContent).toMatchObject({ source: "official_mcp" });

      const performance = await client.callTool({
        name: "get_post_performance",
        arguments: { identifier: postId },
      });
      const latest = (
        performance.structuredContent as {
          latest: { openRate: number; subscriptionsPer1000: number };
        }
      ).latest;
      expect(latest.openRate).toBe(0.5);
      expect(latest.subscriptionsPer1000).toBeCloseTo(30.6122, 4);
    } finally {
      await client.close();
    }
  }, 15_000);
});
