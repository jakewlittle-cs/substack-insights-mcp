import type { AppConfig } from "../config.js";
import { requirePublicationUrl } from "../config.js";
import { Store } from "../database.js";
import { errorMessage, SubstackInsightsError } from "../errors.js";
import type { MetricInput, PostStatus, PostWithVersion, SyncResult } from "../types.js";
import { nowIso } from "../utils.js";
import { fetchPublicationRss } from "../substack/rss.js";

export class ContentService {
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
  ) {}

  status(): Record<string, unknown> {
    const publicationUrl = this.config.publicationUrl;
    const publication = publicationUrl
      ? this.store.getPublicationByUrl(publicationUrl)
      : null;
    return {
      publicationUrl,
      databasePath: this.config.dbPath,
      publicationInitialized: Boolean(publication),
      ingestion: "public_rss",
      credentialsRequired: false,
      ...(publication ? { ledger: this.store.summary(publication.id) } : {}),
    };
  }

  async sync(): Promise<SyncResult> {
    const publicationUrl = requirePublicationUrl(this.config);
    const sync = this.store.startSync("rss");
    let postsSeen = 0;
    let postsChanged = 0;

    try {
      const feed = await fetchPublicationRss(publicationUrl);
      const publication = this.store.ensurePublication(publicationUrl, feed.title);
      for (const input of feed.posts) {
        postsSeen += 1;
        const result = this.store.upsertPost({ ...input, publicationId: publication.id });
        if (result.changed) {
          postsChanged += 1;
        }
      }

      const completedAt = nowIso();
      const result: SyncResult = {
        source: "rss",
        startedAt: sync.startedAt,
        completedAt,
        postsSeen,
        postsChanged,
        snapshotsAdded: 0,
        warnings: [],
      };
      this.store.completeSync(sync.id, result as unknown as Record<string, unknown>);
      return result;
    } catch (error) {
      this.store.failSync(sync.id, errorMessage(error));
      throw error;
    }
  }

  createDraft(input: {
    title: string;
    subtitle?: string | null;
    subject?: string | null;
    preheader?: string | null;
    markdown: string;
  }): PostWithVersion {
    const publicationUrl = requirePublicationUrl(this.config);
    validateTitle(input.title);
    const publication = this.store.ensurePublication(publicationUrl);
    return this.store.createLocalDraft(publication.id, {
      title: input.title.trim(),
      subtitle: input.subtitle ?? null,
      subject: input.subject ?? input.title.trim(),
      preheader: input.preheader ?? null,
      contentMarkdown: input.markdown,
      contentHtml: null,
      contentText: markdownToText(input.markdown),
      documentJson: null,
      metadata: { format: "markdown" },
      source: "local",
    });
  }

  updateDraft(
    postId: string,
    input: {
      title?: string;
      subtitle?: string | null;
      subject?: string | null;
      preheader?: string | null;
      markdown?: string;
    },
  ): PostWithVersion {
    const current = this.store.getPost(postId);
    if (!current.version) {
      throw new SubstackInsightsError("version_missing", "The draft has no content version.");
    }
    if (input.title !== undefined) {
      validateTitle(input.title);
    }
    const currentMetadata = JSON.parse(current.version.metadataJson) as Record<string, unknown>;
    const markdown = input.markdown;
    return this.store.updateLocalDraft(postId, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.subtitle === undefined ? {} : { subtitle: input.subtitle }),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      ...(input.preheader === undefined ? {} : { preheader: input.preheader }),
      ...(markdown === undefined
        ? {}
        : {
            contentMarkdown: markdown,
            contentText: markdownToText(markdown),
          }),
      metadata: currentMetadata,
    });
  }

  listPosts(options: { status?: PostStatus; limit?: number } = {}): PostWithVersion[] {
    const publication = this.requirePublication();
    return this.store.listPosts(publication.id, options);
  }

  getPost(identifier: string): PostWithVersion {
    const publication = this.requirePublication();
    const post = this.store.findPost(publication.id, identifier);
    if (!post) {
      throw new SubstackInsightsError(
        "post_not_found",
        `No post matched identifier ${identifier}.`,
      );
    }
    return post;
  }

  listPostVersions(identifier: string, limit?: number) {
    const post = this.getPost(identifier);
    return this.store.listPostVersions(post.id, limit);
  }

  listAuditEvents(options: { identifier?: string; limit?: number } = {}) {
    const publication = this.requirePublication();
    const postId = options.identifier ? this.getPost(options.identifier).id : undefined;
    return this.store.listAuditEvents(publication.id, {
      ...(postId === undefined ? {} : { postId }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    });
  }

  recordOfficialMetric(
    identifier: string,
    metric: Omit<MetricInput, "publicationId" | "postId" | "source">,
  ) {
    const publication = this.requirePublication();
    const post = this.getPost(identifier);
    return this.store.recordMetric({
      ...metric,
      publicationId: publication.id,
      postId: post.id,
      source: "official_mcp",
    });
  }

  private requirePublication() {
    const url = requirePublicationUrl(this.config);
    const publication = this.store.getPublicationByUrl(url);
    if (!publication) {
      throw new SubstackInsightsError(
        "ledger_empty",
        "Run sync once or create a local draft before querying the ledger.",
      );
    }
    return publication;
  }
}

function validateTitle(value: string): void {
  const length = value.trim().length;
  if (length === 0 || length > 280) {
    throw new SubstackInsightsError(
      "invalid_title",
      "A title must contain between 1 and 280 characters.",
    );
  }
}

function markdownToText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|```$/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+\.)\s+/gm, "")
    .replace(/<!--\s*paywall\s*-->/gi, "")
    .replace(/[*_`~]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
