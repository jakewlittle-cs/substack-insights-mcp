import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SubstackInsightsError } from "./errors.js";
import type {
  MetricInput,
  MetricRecord,
  PostRecord,
  PostStatus,
  PostVersionRecord,
  PostWithVersion,
  PublicationRecord,
  UpsertPostInput,
  VersionInput,
} from "./types.js";
import { canonicalJson, contentDigest, nowIso } from "./utils.js";

type DbRow = Record<string, unknown>;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") {
      chmodSync(path, 0o600);
    }
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publications (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
        remote_id TEXT,
        slug TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
        title TEXT NOT NULL,
        subtitle TEXT,
        audience TEXT,
        email_audience TEXT,
        canonical_url TEXT,
        published_at TEXT,
        scheduled_at TEXT,
        latest_version_id TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(publication_id, remote_id)
      );

      CREATE INDEX IF NOT EXISTS posts_publication_status_idx
        ON posts(publication_id, status, published_at DESC);

      CREATE TABLE IF NOT EXISTS post_versions (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        subject TEXT,
        preheader TEXT,
        content_markdown TEXT,
        content_html TEXT,
        content_text TEXT,
        document_json TEXT,
        metadata_json TEXT NOT NULL,
        digest TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(post_id, version),
        UNIQUE(post_id, digest)
      );

      CREATE INDEX IF NOT EXISTS post_versions_post_idx
        ON post_versions(post_id, version DESC);

      CREATE TABLE IF NOT EXISTS metric_snapshots (
        id TEXT PRIMARY KEY,
        publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        captured_at TEXT NOT NULL,
        source TEXT NOT NULL,
        sent REAL,
        delivered REAL,
        opens REAL,
        open_rate REAL,
        views REAL,
        free_subscriptions REAL,
        paid_subscriptions REAL,
        signups REAL,
        unsubscribes REAL,
        likes REAL,
        comments REAL,
        shares REAL,
        revenue_cents REAL,
        estimated_value REAL,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(post_id, captured_at, source)
      );

      CREATE INDEX IF NOT EXISTS metric_snapshots_post_time_idx
        ON metric_snapshots(post_id, captured_at DESC);

      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        stats_json TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  ensurePublication(url: string, name: string | null = null): PublicationRecord {
    const existing = this.db.prepare("SELECT * FROM publications WHERE url = ?").get(url) as
      | DbRow
      | undefined;
    const timestamp = nowIso();

    if (existing) {
      if (name && name !== existing.name) {
        this.db
          .prepare("UPDATE publications SET name = ?, updated_at = ? WHERE id = ?")
          .run(name, timestamp, String(existing.id));
        existing.name = name;
        existing.updated_at = timestamp;
      }
      return publicationFromRow(existing);
    }

    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO publications (id, url, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, url, name, timestamp, timestamp);
    return { id, url, name, createdAt: timestamp, updatedAt: timestamp };
  }

  getPublicationByUrl(url: string): PublicationRecord | null {
    const row = this.db.prepare("SELECT * FROM publications WHERE url = ?").get(url) as
      | DbRow
      | undefined;
    return row ? publicationFromRow(row) : null;
  }

  upsertPost(input: UpsertPostInput): { post: PostWithVersion; changed: boolean } {
    let existing = input.remoteId
      ? (this.db
          .prepare("SELECT * FROM posts WHERE publication_id = ? AND remote_id = ?")
          .get(input.publicationId, input.remoteId) as DbRow | undefined)
      : undefined;

    if (!existing && input.canonicalUrl) {
      existing = this.db
        .prepare("SELECT * FROM posts WHERE publication_id = ? AND canonical_url = ?")
        .get(input.publicationId, input.canonicalUrl) as DbRow | undefined;
    }
    if (!existing && input.slug) {
      existing = this.db
        .prepare("SELECT * FROM posts WHERE publication_id = ? AND slug = ?")
        .get(input.publicationId, input.slug) as DbRow | undefined;
    }

    const timestamp = nowIso();
    const postId = existing ? String(existing.id) : randomUUID();

    if (existing) {
      const existingRemoteId = nullableString(existing.remote_id);
      this.db
        .prepare(`
          UPDATE posts SET
            remote_id = ?, slug = ?, status = ?, title = ?, subtitle = ?, audience = ?,
            email_audience = ?, canonical_url = ?, published_at = ?, scheduled_at = ?,
            source = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          input.source === "rss" && existingRemoteId
            ? existingRemoteId
            : (input.remoteId ?? existingRemoteId),
          input.slug ?? null,
          input.status,
          input.title,
          input.subtitle ?? null,
          input.audience ?? null,
          input.emailAudience ?? null,
          input.canonicalUrl ?? null,
          input.publishedAt ?? null,
          input.scheduledAt ?? null,
          input.source,
          timestamp,
          postId,
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO posts (
            id, publication_id, remote_id, slug, status, title, subtitle, audience,
            email_audience, canonical_url, published_at, scheduled_at, latest_version_id,
            source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        `)
        .run(
          postId,
          input.publicationId,
          input.remoteId ?? null,
          input.slug ?? null,
          input.status,
          input.title,
          input.subtitle ?? null,
          input.audience ?? null,
          input.emailAudience ?? null,
          input.canonicalUrl ?? null,
          input.publishedAt ?? null,
          input.scheduledAt ?? null,
          input.source,
          timestamp,
          timestamp,
        );
    }

    const versionResult = this.addVersion(postId, input);
    return {
      post: this.getPost(postId),
      changed: !existing || versionResult.changed,
    };
  }

  createLocalDraft(publicationId: string, input: VersionInput): PostWithVersion {
    const id = randomUUID();
    const timestamp = nowIso();
    this.db
      .prepare(`
        INSERT INTO posts (
          id, publication_id, remote_id, slug, status, title, subtitle, audience,
          email_audience, canonical_url, published_at, scheduled_at, latest_version_id,
          source, created_at, updated_at
        ) VALUES (?, ?, NULL, NULL, 'draft', ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'local', ?, ?)
      `)
      .run(
        id,
        publicationId,
        input.title,
        input.subtitle ?? null,
        input.metadata?.audience ? String(input.metadata.audience) : "everyone",
        input.metadata?.emailAudience ? String(input.metadata.emailAudience) : "everyone",
        timestamp,
        timestamp,
      );
    this.addVersion(id, { ...input, source: "local" });
    this.audit("local_draft_created", id, { title: input.title });
    return this.getPost(id);
  }

  updateLocalDraft(postId: string, input: Partial<Omit<VersionInput, "source">>): PostWithVersion {
    const current = this.getPost(postId);
    if (current.status === "published") {
      throw new SubstackInsightsError(
        "published_post_immutable",
        "Create a new draft instead of changing the canonical sent version.",
      );
    }
    if (!current.version) {
      throw new SubstackInsightsError("version_missing", "The draft has no content version.");
    }

    const merged: VersionInput = {
      title: input.title ?? current.version.title,
      subtitle: input.subtitle === undefined ? current.version.subtitle : input.subtitle,
      subject: input.subject === undefined ? current.version.subject : input.subject,
      preheader: input.preheader === undefined ? current.version.preheader : input.preheader,
      contentMarkdown:
        input.contentMarkdown === undefined
          ? current.version.contentMarkdown
          : input.contentMarkdown,
      contentHtml:
        input.contentHtml === undefined ? current.version.contentHtml : input.contentHtml,
      contentText:
        input.contentText === undefined ? current.version.contentText : input.contentText,
      documentJson:
        input.documentJson === undefined ? current.version.documentJson : input.documentJson,
      metadata:
        input.metadata === undefined
          ? (JSON.parse(current.version.metadataJson) as Record<string, unknown>)
          : input.metadata,
      source: "local",
    };

    const result = this.addVersion(postId, merged);
    this.db
      .prepare("UPDATE posts SET title = ?, subtitle = ?, source = 'local', updated_at = ? WHERE id = ?")
      .run(merged.title, merged.subtitle ?? null, nowIso(), postId);
    this.audit("local_draft_updated", postId, {
      versionId: result.version.id,
      digest: result.version.digest,
    });
    return this.getPost(postId);
  }

  private addVersion(
    postId: string,
    input: VersionInput,
  ): { version: PostVersionRecord; changed: boolean } {
    const metadataJson = canonicalJson(input.metadata ?? {});
    const digest = contentDigest({
      title: input.title,
      subtitle: input.subtitle ?? null,
      subject: input.subject ?? null,
      preheader: input.preheader ?? null,
      contentMarkdown: input.contentMarkdown ?? null,
      contentHtml: input.contentHtml ?? null,
      contentText: input.contentText ?? null,
      documentJson: input.documentJson ?? null,
      metadata: input.metadata ?? {},
    });
    const existing = this.db
      .prepare("SELECT * FROM post_versions WHERE post_id = ? AND digest = ?")
      .get(postId, digest) as DbRow | undefined;

    if (existing) {
      this.db
        .prepare("UPDATE posts SET latest_version_id = ?, updated_at = ? WHERE id = ?")
        .run(String(existing.id), nowIso(), postId);
      return { version: versionFromRow(existing), changed: false };
    }

    const countRow = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS current_version FROM post_versions WHERE post_id = ?")
      .get(postId) as DbRow;
    const nextVersion = Number(countRow.current_version ?? 0) + 1;
    const id = randomUUID();
    const createdAt = nowIso();
    this.db
      .prepare(`
        INSERT INTO post_versions (
          id, post_id, version, title, subtitle, subject, preheader, content_markdown,
          content_html, content_text, document_json, metadata_json, digest, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        postId,
        nextVersion,
        input.title,
        input.subtitle ?? null,
        input.subject ?? null,
        input.preheader ?? null,
        input.contentMarkdown ?? null,
        input.contentHtml ?? null,
        input.contentText ?? null,
        input.documentJson ?? null,
        metadataJson,
        digest,
        input.source,
        createdAt,
      );
    this.db
      .prepare("UPDATE posts SET latest_version_id = ?, title = ?, subtitle = ?, updated_at = ? WHERE id = ?")
      .run(id, input.title, input.subtitle ?? null, createdAt, postId);

    return {
      version: {
        id,
        postId,
        version: nextVersion,
        title: input.title,
        subtitle: input.subtitle ?? null,
        subject: input.subject ?? null,
        preheader: input.preheader ?? null,
        contentMarkdown: input.contentMarkdown ?? null,
        contentHtml: input.contentHtml ?? null,
        contentText: input.contentText ?? null,
        documentJson: input.documentJson ?? null,
        metadataJson,
        digest,
        source: input.source,
        createdAt,
      },
      changed: true,
    };
  }

  getPost(postId: string): PostWithVersion {
    const row = this.db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) as
      | DbRow
      | undefined;
    if (!row) {
      throw new SubstackInsightsError("post_not_found", `No local post exists with id ${postId}.`);
    }

    const post = postFromRow(row);
    const versionRow = post.latestVersionId
      ? (this.db.prepare("SELECT * FROM post_versions WHERE id = ?").get(post.latestVersionId) as
          | DbRow
          | undefined)
      : undefined;
    return { ...post, version: versionRow ? versionFromRow(versionRow) : null };
  }

  listPostVersions(postId: string, limit = 100): PostVersionRecord[] {
    return (this.db
      .prepare("SELECT * FROM post_versions WHERE post_id = ? ORDER BY version DESC LIMIT ?")
      .all(postId, Math.min(Math.max(limit, 1), 1_000)) as DbRow[]).map(versionFromRow);
  }

  findPostByRemoteId(publicationId: string, remoteId: string): PostWithVersion | null {
    const row = this.db
      .prepare("SELECT id FROM posts WHERE publication_id = ? AND remote_id = ?")
      .get(publicationId, remoteId) as DbRow | undefined;
    return row ? this.getPost(String(row.id)) : null;
  }

  findPost(publicationId: string, identifier: string): PostWithVersion | null {
    const row = this.db
      .prepare(`
        SELECT id FROM posts
        WHERE publication_id = ? AND (
          id = ? OR remote_id = ? OR slug = ? OR canonical_url = ? OR title = ?
        )
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      .get(publicationId, identifier, identifier, identifier, identifier, identifier) as
      | DbRow
      | undefined;
    return row ? this.getPost(String(row.id)) : null;
  }

  listPosts(
    publicationId: string,
    options: { status?: PostStatus; limit?: number } = {},
  ): PostWithVersion[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = options.status
      ? (this.db
          .prepare(`
            SELECT id FROM posts
            WHERE publication_id = ? AND status = ?
            ORDER BY COALESCE(published_at, scheduled_at, updated_at) DESC
            LIMIT ?
          `)
          .all(publicationId, options.status, limit) as DbRow[])
      : (this.db
          .prepare(`
            SELECT id FROM posts
            WHERE publication_id = ?
            ORDER BY COALESCE(published_at, scheduled_at, updated_at) DESC
            LIMIT ?
          `)
          .all(publicationId, limit) as DbRow[]);
    return rows.map((row) => this.getPost(String(row.id)));
  }

  recordMetric(input: MetricInput): MetricRecord {
    const id = randomUUID();
    const capturedAt = input.capturedAt ?? nowIso();
    const createdAt = nowIso();
    const values = {
      sent: input.sent ?? null,
      delivered: input.delivered ?? null,
      opens: input.opens ?? null,
      openRate: input.openRate ?? null,
      views: input.views ?? null,
      freeSubscriptions: input.freeSubscriptions ?? null,
      paidSubscriptions: input.paidSubscriptions ?? null,
      signups: input.signups ?? null,
      unsubscribes: input.unsubscribes ?? null,
      likes: input.likes ?? null,
      comments: input.comments ?? null,
      shares: input.shares ?? null,
      revenueCents: input.revenueCents ?? null,
      estimatedValue: input.estimatedValue ?? null,
    };
    const rawJson = canonicalJson(input.raw ?? {});

    this.db
      .prepare(`
        INSERT INTO metric_snapshots (
          id, publication_id, post_id, captured_at, source, sent, delivered, opens,
          open_rate, views, free_subscriptions, paid_subscriptions, signups,
          unsubscribes, likes, comments, shares, revenue_cents, estimated_value,
          raw_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(post_id, captured_at, source) DO UPDATE SET
          sent = excluded.sent,
          delivered = excluded.delivered,
          opens = excluded.opens,
          open_rate = excluded.open_rate,
          views = excluded.views,
          free_subscriptions = excluded.free_subscriptions,
          paid_subscriptions = excluded.paid_subscriptions,
          signups = excluded.signups,
          unsubscribes = excluded.unsubscribes,
          likes = excluded.likes,
          comments = excluded.comments,
          shares = excluded.shares,
          revenue_cents = excluded.revenue_cents,
          estimated_value = excluded.estimated_value,
          raw_json = excluded.raw_json
      `)
      .run(
        id,
        input.publicationId,
        input.postId,
        capturedAt,
        input.source,
        values.sent,
        values.delivered,
        values.opens,
        values.openRate,
        values.views,
        values.freeSubscriptions,
        values.paidSubscriptions,
        values.signups,
        values.unsubscribes,
        values.likes,
        values.comments,
        values.shares,
        values.revenueCents,
        values.estimatedValue,
        rawJson,
        createdAt,
      );

    const row = this.db
      .prepare("SELECT * FROM metric_snapshots WHERE post_id = ? AND captured_at = ? AND source = ?")
      .get(input.postId, capturedAt, input.source) as DbRow;
    return metricFromRow(row);
  }

  latestMetric(postId: string): MetricRecord | null {
    const row = this.db
      .prepare("SELECT * FROM metric_snapshots WHERE post_id = ? ORDER BY captured_at DESC LIMIT 1")
      .get(postId) as DbRow | undefined;
    return row ? metricFromRow(row) : null;
  }

  metricHistory(postId: string, limit = 100): MetricRecord[] {
    return (this.db
      .prepare("SELECT * FROM metric_snapshots WHERE post_id = ? ORDER BY captured_at DESC LIMIT ?")
      .all(postId, Math.min(Math.max(limit, 1), 1000)) as DbRow[]).map(metricFromRow);
  }

  startSync(source: string): { id: string; startedAt: string } {
    const id = randomUUID();
    const startedAt = nowIso();
    this.db
      .prepare("INSERT INTO sync_runs (id, source, status, started_at) VALUES (?, ?, 'running', ?)")
      .run(id, source, startedAt);
    return { id, startedAt };
  }

  completeSync(id: string, stats: Record<string, unknown>): void {
    this.db
      .prepare(`
        UPDATE sync_runs SET status = 'completed', completed_at = ?, stats_json = ? WHERE id = ?
      `)
      .run(nowIso(), canonicalJson(stats), id);
  }

  failSync(id: string, error: string): void {
    this.db
      .prepare("UPDATE sync_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?")
      .run(nowIso(), error, id);
  }

  audit(eventType: string, postId: string | null, payload: Record<string, unknown>): void {
    this.db
      .prepare(`
        INSERT INTO audit_events (id, event_type, post_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(randomUUID(), eventType, postId, canonicalJson(payload), nowIso());
  }

  listAuditEvents(
    publicationId: string,
    options: { postId?: string; limit?: number } = {},
  ): Array<Record<string, unknown>> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1_000);
    const rows = options.postId
      ? (this.db
          .prepare(`
            SELECT a.* FROM audit_events a
            JOIN posts p ON p.id = a.post_id
            WHERE p.publication_id = ? AND a.post_id = ?
            ORDER BY a.created_at DESC LIMIT ?
          `)
          .all(publicationId, options.postId, limit) as DbRow[])
      : (this.db
          .prepare(`
            SELECT a.* FROM audit_events a
            JOIN posts p ON p.id = a.post_id
            WHERE p.publication_id = ?
            ORDER BY a.created_at DESC LIMIT ?
          `)
          .all(publicationId, limit) as DbRow[]);
    return rows.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      postId: nullableString(row.post_id),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      createdAt: String(row.created_at),
    }));
  }

  summary(publicationId: string): Record<string, unknown> {
    const postCounts = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM posts WHERE publication_id = ? GROUP BY status")
      .all(publicationId) as DbRow[];
    const snapshotRow = this.db
      .prepare(`
        SELECT COUNT(*) AS count, MAX(captured_at) AS latest
        FROM metric_snapshots WHERE publication_id = ?
      `)
      .get(publicationId) as DbRow;
    const syncRow = this.db
      .prepare("SELECT source, status, started_at, completed_at, error FROM sync_runs ORDER BY started_at DESC LIMIT 1")
      .get() as DbRow | undefined;
    return {
      posts: Object.fromEntries(
        postCounts.map((row) => [String(row.status), Number(row.count)]),
      ),
      metricSnapshots: Number(snapshotRow.count ?? 0),
      latestMetricAt: snapshotRow.latest ? String(snapshotRow.latest) : null,
      latestSync: syncRow ?? null,
    };
  }
}

function publicationFromRow(row: DbRow): PublicationRecord {
  return {
    id: String(row.id),
    url: String(row.url),
    name: row.name === null || row.name === undefined ? null : String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function postFromRow(row: DbRow): PostRecord {
  return {
    id: String(row.id),
    publicationId: String(row.publication_id),
    remoteId: nullableString(row.remote_id),
    slug: nullableString(row.slug),
    status: String(row.status) as PostStatus,
    title: String(row.title),
    subtitle: nullableString(row.subtitle),
    audience: nullableString(row.audience),
    emailAudience: nullableString(row.email_audience),
    canonicalUrl: nullableString(row.canonical_url),
    publishedAt: nullableString(row.published_at),
    scheduledAt: nullableString(row.scheduled_at),
    latestVersionId: nullableString(row.latest_version_id),
    source: String(row.source) as PostRecord["source"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function versionFromRow(row: DbRow): PostVersionRecord {
  return {
    id: String(row.id),
    postId: String(row.post_id),
    version: Number(row.version),
    title: String(row.title),
    subtitle: nullableString(row.subtitle),
    subject: nullableString(row.subject),
    preheader: nullableString(row.preheader),
    contentMarkdown: nullableString(row.content_markdown),
    contentHtml: nullableString(row.content_html),
    contentText: nullableString(row.content_text),
    documentJson: nullableString(row.document_json),
    metadataJson: String(row.metadata_json),
    digest: String(row.digest),
    source: String(row.source) as PostVersionRecord["source"],
    createdAt: String(row.created_at),
  };
}

function metricFromRow(row: DbRow): MetricRecord {
  return {
    id: String(row.id),
    publicationId: String(row.publication_id),
    postId: String(row.post_id),
    capturedAt: String(row.captured_at),
    source: String(row.source) as MetricRecord["source"],
    sent: nullableNumber(row.sent),
    delivered: nullableNumber(row.delivered),
    opens: nullableNumber(row.opens),
    openRate: nullableNumber(row.open_rate),
    views: nullableNumber(row.views),
    freeSubscriptions: nullableNumber(row.free_subscriptions),
    paidSubscriptions: nullableNumber(row.paid_subscriptions),
    signups: nullableNumber(row.signups),
    unsubscribes: nullableNumber(row.unsubscribes),
    likes: nullableNumber(row.likes),
    comments: nullableNumber(row.comments),
    shares: nullableNumber(row.shares),
    revenueCents: nullableNumber(row.revenue_cents),
    estimatedValue: nullableNumber(row.estimated_value),
    rawJson: String(row.raw_json),
    createdAt: String(row.created_at),
  };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
