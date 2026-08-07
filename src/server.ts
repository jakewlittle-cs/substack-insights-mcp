import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { Application } from "./app.js";
import { errorPayload } from "./errors.js";
import type { PerformanceMetric } from "./services/analytics-service.js";
import type { PostWithVersion } from "./types.js";

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const syncAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const localWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const metricSchema = {
  capturedAt: z.iso.datetime().optional(),
  sent: z.number().nonnegative().nullable().optional(),
  delivered: z.number().nonnegative().nullable().optional(),
  opens: z.number().nonnegative().nullable().optional(),
  openRate: z.number().min(0).max(1).nullable().optional(),
  views: z.number().nonnegative().nullable().optional(),
  freeSubscriptions: z.number().nonnegative().nullable().optional(),
  paidSubscriptions: z.number().nonnegative().nullable().optional(),
  signups: z.number().nonnegative().nullable().optional(),
  unsubscribes: z.number().nonnegative().nullable().optional(),
  likes: z.number().nonnegative().nullable().optional(),
  comments: z.number().nonnegative().nullable().optional(),
  shares: z.number().nonnegative().nullable().optional(),
  revenueCents: z.number().nonnegative().nullable().optional(),
  estimatedValue: z.number().nonnegative().nullable().optional(),
};

export function buildMcpServer(app: Application): McpServer {
  const server = new McpServer(
    { name: "substack-insights", version: "0.1.0" },
    {
      instructions:
        "Use read tools freely. Never infer missing metrics: report every snapshot's source and capture time. Treat correlations as descriptive, compare posts at similar measurement ages, and preserve exact content digests when discussing historical versions. This server never authenticates to Substack and cannot publish.",
    },
  );

  server.registerTool(
    "connection_status",
    {
      title: "Substack Insights connection status",
      description:
        "Show publication configuration, local ledger counts, and synchronization freshness.",
      inputSchema: z.object({}),
      annotations: readAnnotations,
    },
    safe(async () => app.content.status()),
  );

  server.registerTool(
    "sync_publication",
    {
      title: "Synchronize Substack publication",
      description:
        "Import the publication's public RSS archive into the local immutable ledger. No credentials are used.",
      inputSchema: z.object({}),
      annotations: syncAnnotations,
    },
    safe(async () => app.content.sync()),
  );

  server.registerTool(
    "list_posts",
    {
      title: "List locally tracked posts",
      description:
        "List canonical post records and content-version digests. This omits full bodies; use get_post for exact content.",
      inputSchema: z.object({
        status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      annotations: readAnnotations,
    },
    safe(async ({ status, limit }) =>
      app.content
        .listPosts({
          ...(status === undefined ? {} : { status }),
          ...(limit === undefined ? {} : { limit }),
        })
        .map(summarizePost),
    ),
  );

  server.registerTool(
    "get_post",
    {
      title: "Get exact post content and history pointer",
      description:
        "Return the canonical record and latest immutable content version for a local id, remote id, slug, canonical URL, or exact title.",
      inputSchema: z.object({ identifier: z.string().min(1) }),
      annotations: readAnnotations,
    },
    safe(async ({ identifier }) => app.content.getPost(identifier)),
  );

  server.registerTool(
    "list_post_versions",
    {
      title: "List immutable post versions",
      description:
        "Return the stored content-version history for one post, newest first, including exact bodies and SHA-256 digests.",
      inputSchema: z.object({
        identifier: z.string().min(1),
        limit: z.number().int().min(1).max(1_000).optional(),
      }),
      annotations: readAnnotations,
    },
    safe(async ({ identifier, limit }) => app.content.listPostVersions(identifier, limit)),
  );

  server.registerTool(
    "list_audit_events",
    {
      title: "List ledger audit events",
      description:
        "Return timestamped RSS imports and local content changes, optionally scoped to one post.",
      inputSchema: z.object({
        identifier: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(1_000).optional(),
      }),
      annotations: readAnnotations,
    },
    safe(async ({ identifier, limit }) =>
      app.content.listAuditEvents({
        ...(identifier === undefined ? {} : { identifier }),
        ...(limit === undefined ? {} : { limit }),
      }),
    ),
  );

  server.registerTool(
    "record_metric_snapshot",
    {
      title: "Record an official MCP metric snapshot",
      description:
        "Store timestamped metrics obtained from Substack's official MCP against an existing post. Never enter estimates.",
      inputSchema: z.object({
        identifier: z.string().min(1),
        ...metricSchema,
      }),
      annotations: localWriteAnnotations,
    },
    safe(async ({ identifier, ...metric }) => app.content.recordOfficialMetric(identifier, metric)),
  );

  server.registerTool(
    "get_post_performance",
    {
      title: "Get post performance",
      description:
        "Return the latest derived performance rates plus every stored raw metric snapshot for one post.",
      inputSchema: z.object({ identifier: z.string().min(1) }),
      annotations: readAnnotations,
    },
    safe(async ({ identifier }) =>
      app.analytics.performance(app.content.getPost(identifier)),
    ),
  );

  server.registerTool(
    "compare_posts",
    {
      title: "Rank comparable post performance",
      description:
        "Rank posts using normalized, deterministic rates from each post's latest stored snapshot.",
      inputSchema: z.object({
        metric: z.enum([
          "open_rate",
          "subscriptions_per_1000",
          "views_per_1000",
          "engagement_rate",
        ]),
        status: z.enum(["draft", "scheduled", "published", "archived"]).default("published"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readAnnotations,
    },
    safe(async ({ metric, status, limit }) =>
      app.analytics.compare(
        app.content.listPosts({ status, limit: 500 }),
        metric as PerformanceMetric,
        limit,
      ),
    ),
  );

  server.registerTool(
    "analyze_content_patterns",
    {
      title: "Analyze content-performance patterns",
      description:
        "Calculate correlations between performance and word count, title length, and UTC send hour. Requires at least three measured posts.",
      inputSchema: z.object({
        metric: z.enum([
          "open_rate",
          "subscriptions_per_1000",
          "views_per_1000",
          "engagement_rate",
        ]),
      }),
      annotations: readAnnotations,
    },
    safe(async ({ metric }) =>
      app.analytics.contentPatterns(
        app.content.listPosts({ status: "published", limit: 500 }),
        metric as PerformanceMetric,
      ),
    ),
  );

  server.registerTool(
    "create_local_draft",
    {
      title: "Create an immutable local draft version",
      description:
        "Create local Markdown content in the immutable ledger. This never contacts or publishes to Substack.",
      inputSchema: z.object({
        title: z.string().min(1).max(280),
        subtitle: z.string().max(280).nullable().optional(),
        subject: z.string().max(280).nullable().optional(),
        preheader: z.string().max(500).nullable().optional(),
        markdown: z.string().min(1),
      }),
      annotations: localWriteAnnotations,
    },
    safe(async (input) => app.content.createDraft(input)),
  );

  server.registerTool(
    "update_local_draft",
    {
      title: "Create a new local draft version",
      description:
        "Update selected local draft fields by appending an immutable version. Existing sent versions cannot be changed.",
      inputSchema: z.object({
        postId: z.string().uuid(),
        title: z.string().min(1).max(280).optional(),
        subtitle: z.string().max(280).nullable().optional(),
        subject: z.string().max(280).nullable().optional(),
        preheader: z.string().max(500).nullable().optional(),
        markdown: z.string().min(1).optional(),
      }),
      annotations: localWriteAnnotations,
    },
    safe(async ({ postId, ...input }) => app.content.updateDraft(postId, input)),
  );

  return server;
}

function safe<T>(handler: (input: T) => Promise<unknown>) {
  return async (input: T): Promise<CallToolResult> => {
    try {
      return success(await handler(input));
    } catch (error) {
      const payload = errorPayload(error);
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  };
}

function success(value: unknown): CallToolResult {
  const jsonValue = JSON.parse(JSON.stringify(value)) as unknown;
  const structuredContent =
    jsonValue !== null && typeof jsonValue === "object" && !Array.isArray(jsonValue)
      ? (jsonValue as Record<string, unknown>)
      : { result: jsonValue };
  return {
    content: [{ type: "text", text: JSON.stringify(jsonValue, null, 2) }],
    structuredContent,
  };
}

function summarizePost(post: PostWithVersion): Record<string, unknown> {
  return {
    id: post.id,
    remoteId: post.remoteId,
    slug: post.slug,
    status: post.status,
    title: post.title,
    subtitle: post.subtitle,
    audience: post.audience,
    emailAudience: post.emailAudience,
    canonicalUrl: post.canonicalUrl,
    publishedAt: post.publishedAt,
    scheduledAt: post.scheduledAt,
    source: post.source,
    latestVersion: post.version
      ? {
          id: post.version.id,
          number: post.version.version,
          digest: post.version.digest,
          source: post.version.source,
          createdAt: post.version.createdAt,
        }
      : null,
  };
}
