export type PostStatus = "draft" | "scheduled" | "published" | "archived";

export type PostSource = "local" | "rss" | "official_mcp" | "manual";

export interface PublicationRecord {
  id: string;
  url: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostRecord {
  id: string;
  publicationId: string;
  remoteId: string | null;
  slug: string | null;
  status: PostStatus;
  title: string;
  subtitle: string | null;
  audience: string | null;
  emailAudience: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  latestVersionId: string | null;
  source: PostSource;
  createdAt: string;
  updatedAt: string;
}

export interface PostVersionRecord {
  id: string;
  postId: string;
  version: number;
  title: string;
  subtitle: string | null;
  subject: string | null;
  preheader: string | null;
  contentMarkdown: string | null;
  contentHtml: string | null;
  contentText: string | null;
  documentJson: string | null;
  metadataJson: string;
  digest: string;
  source: PostSource;
  createdAt: string;
}

export interface PostWithVersion extends PostRecord {
  version: PostVersionRecord | null;
}

export interface VersionInput {
  title: string;
  subtitle?: string | null;
  subject?: string | null;
  preheader?: string | null;
  contentMarkdown?: string | null;
  contentHtml?: string | null;
  contentText?: string | null;
  documentJson?: string | null;
  metadata?: Record<string, unknown>;
  source: PostSource;
}

export interface UpsertPostInput extends VersionInput {
  publicationId: string;
  remoteId?: string | null;
  slug?: string | null;
  status: PostStatus;
  audience?: string | null;
  emailAudience?: string | null;
  canonicalUrl?: string | null;
  publishedAt?: string | null;
  scheduledAt?: string | null;
}

export interface MetricInput {
  publicationId: string;
  postId: string;
  capturedAt?: string;
  source: PostSource;
  sent?: number | null;
  delivered?: number | null;
  opens?: number | null;
  openRate?: number | null;
  views?: number | null;
  freeSubscriptions?: number | null;
  paidSubscriptions?: number | null;
  signups?: number | null;
  unsubscribes?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  revenueCents?: number | null;
  estimatedValue?: number | null;
  raw?: Record<string, unknown>;
}

export interface MetricRecord extends Required<Omit<MetricInput, "raw">> {
  id: string;
  rawJson: string;
  createdAt: string;
}

export interface SyncResult {
  source: string;
  startedAt: string;
  completedAt: string;
  postsSeen: number;
  postsChanged: number;
  snapshotsAdded: number;
  warnings: string[];
}
