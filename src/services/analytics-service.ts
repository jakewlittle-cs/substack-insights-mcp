import { Store } from "../database.js";
import { SubstackInsightsError } from "../errors.js";
import type { MetricRecord, PostWithVersion } from "../types.js";

export type PerformanceMetric =
  | "open_rate"
  | "subscriptions_per_1000"
  | "views_per_1000"
  | "engagement_rate";

interface PerformanceRow {
  postId: string;
  remoteId: string | null;
  title: string;
  publishedAt: string | null;
  wordCount: number;
  titleLength: number;
  delivered: number | null;
  openRate: number | null;
  subscriptionsPer1000: number | null;
  viewsPer1000: number | null;
  engagementRate: number | null;
  capturedAt: string;
  source: string;
}

export class AnalyticsService {
  constructor(private readonly store: Store) {}

  performance(post: PostWithVersion): Record<string, unknown> {
    const history = this.store.metricHistory(post.id);
    return {
      post: summarizePost(post),
      latest: history[0] ? derive(post, history[0]) : null,
      history,
    };
  }

  compare(posts: PostWithVersion[], metric: PerformanceMetric, limit = 20): Record<string, unknown> {
    const rows = posts
      .map((post) => {
        const snapshot = this.store.latestMetric(post.id);
        return snapshot ? derive(post, snapshot) : null;
      })
      .filter((row): row is PerformanceRow => row !== null)
      .filter((row) => metricValue(row, metric) !== null)
      .sort((left, right) => (metricValue(right, metric) ?? 0) - (metricValue(left, metric) ?? 0))
      .slice(0, Math.min(Math.max(limit, 1), 100));
    return {
      metric,
      count: rows.length,
      rows,
      note: "Rates are computed from the latest stored snapshot for each post.",
    };
  }

  contentPatterns(posts: PostWithVersion[], metric: PerformanceMetric): Record<string, unknown> {
    const rows = posts
      .map((post) => {
        const snapshot = this.store.latestMetric(post.id);
        return snapshot ? derive(post, snapshot) : null;
      })
      .filter((row): row is PerformanceRow => row !== null)
      .filter((row) => metricValue(row, metric) !== null);

    if (rows.length < 3) {
      throw new SubstackInsightsError(
        "insufficient_analytics",
        `At least 3 posts with ${metric} data are required; ${rows.length} are available.`,
      );
    }
    const y = rows.map((row) => metricValue(row, metric) ?? 0);
    const wordCounts = rows.map((row) => row.wordCount);
    const titleLengths = rows.map((row) => row.titleLength);
    const sendHours = rows.map((row) =>
      row.publishedAt ? new Date(row.publishedAt).getUTCHours() : 0,
    );
    const ordered = [...rows].sort(
      (left, right) => (metricValue(right, metric) ?? 0) - (metricValue(left, metric) ?? 0),
    );

    return {
      metric,
      sampleSize: rows.length,
      correlations: {
        wordCount: pearson(wordCounts, y),
        titleLength: pearson(titleLengths, y),
        sendHourUtc: pearson(sendHours, y),
      },
      top: ordered.slice(0, 5),
      bottom: ordered.slice(-5).reverse(),
      caution:
        "Correlations describe this publication's stored history; they do not establish causation.",
    };
  }
}

function derive(post: PostWithVersion, metric: MetricRecord): PerformanceRow {
  const delivered = metric.delivered ?? metric.sent;
  const openRate =
    metric.openRate ??
    (delivered !== null && delivered > 0 && metric.opens !== null
      ? metric.opens / delivered
      : null);
  const subscriptions =
    metric.signups ?? (metric.freeSubscriptions ?? 0) + (metric.paidSubscriptions ?? 0);
  const body =
    post.version?.contentText ?? post.version?.contentMarkdown ?? post.version?.contentHtml ?? "";
  const interactions =
    (metric.likes ?? 0) + (metric.comments ?? 0) + (metric.shares ?? 0);
  return {
    postId: post.id,
    remoteId: post.remoteId,
    title: post.title,
    publishedAt: post.publishedAt,
    wordCount: body.trim() ? body.trim().split(/\s+/).length : 0,
    titleLength: post.title.length,
    delivered,
    openRate,
    subscriptionsPer1000:
      delivered !== null && delivered > 0 ? (subscriptions / delivered) * 1_000 : null,
    viewsPer1000:
      delivered !== null && delivered > 0 && metric.views !== null
        ? (metric.views / delivered) * 1_000
        : null,
    engagementRate:
      metric.views !== null && metric.views > 0 ? interactions / metric.views : null,
    capturedAt: metric.capturedAt,
    source: metric.source,
  };
}

function metricValue(row: PerformanceRow, metric: PerformanceMetric): number | null {
  switch (metric) {
    case "open_rate":
      return row.openRate;
    case "subscriptions_per_1000":
      return row.subscriptionsPer1000;
    case "views_per_1000":
      return row.viewsPer1000;
    case "engagement_rate":
      return row.engagementRate;
  }
}

function summarizePost(post: PostWithVersion): Record<string, unknown> {
  return {
    id: post.id,
    remoteId: post.remoteId,
    title: post.title,
    status: post.status,
    publishedAt: post.publishedAt,
    canonicalUrl: post.canonicalUrl,
    version: post.version?.version ?? null,
    contentDigest: post.version?.digest ?? null,
  };
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 3) {
    return null;
  }
  const meanLeft = average(left);
  const meanRight = average(right);
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = (left[index] ?? 0) - meanLeft;
    const rightDelta = (right[index] ?? 0) - meanRight;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta ** 2;
    rightSquares += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
