import { describe, expect, it } from "vitest";

import { Store } from "../src/database.js";
import { AnalyticsService } from "../src/services/analytics-service.js";

describe("AnalyticsService", () => {
  it("normalizes performance by deliveries and reports correlations", () => {
    const store = new Store(":memory:");
    const publication = store.ensurePublication("https://example.substack.com");
    const posts = [100, 200, 300].map((words, index) => {
      const post = store.upsertPost({
        publicationId: publication.id,
        remoteId: String(index + 1),
        status: "published",
        title: `Post ${index + 1}`,
        contentText: Array.from({ length: words }, () => "word").join(" "),
        publishedAt: `2026-08-0${index + 1}T1${index}:00:00.000Z`,
        source: "manual",
      }).post;
      store.recordMetric({
        publicationId: publication.id,
        postId: post.id,
        source: "official_mcp",
        delivered: 1_000,
        opens: 400 + index * 100,
        signups: 10 + index * 10,
        views: 500 + index * 100,
        likes: 10 + index,
      });
      return post;
    });
    const analytics = new AnalyticsService(store);
    const comparison = analytics.compare(posts, "subscriptions_per_1000") as {
      rows: Array<{ title: string }>;
    };
    expect(comparison.rows[0]?.title).toBe("Post 3");
    const patterns = analytics.contentPatterns(posts, "open_rate") as {
      correlations: { wordCount: number };
    };
    expect(patterns.correlations.wordCount).toBe(1);
    store.close();
  });
});
