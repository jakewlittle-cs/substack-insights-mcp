import { XMLParser } from "fast-xml-parser";

import { SubstackInsightsError } from "../errors.js";
import type { UpsertPostInput } from "../types.js";
import { asString, ensureArray, nullIfEmpty, sha256 } from "../utils.js";

type XmlRecord = Record<string, unknown>;

export interface RssFeed {
  title: string | null;
  posts: Omit<UpsertPostInput, "publicationId">[];
}

export async function fetchPublicationRss(
  publicationUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RssFeed> {
  const response = await fetchImpl(`${publicationUrl}/feed`, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent": "SubstackOpsMCP/0.1 (+local publication sync)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new SubstackInsightsError(
      "rss_fetch_failed",
      `Substack RSS returned HTTP ${response.status}.`,
    );
  }
  return parsePublicationRss(await response.text(), publicationUrl);
}

export function parsePublicationRss(xml: string, publicationUrl: string): RssFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    trimValues: false,
  });
  const parsed = parser.parse(xml) as XmlRecord;
  const rss = record(parsed.rss);
  const channel = record(rss.channel);
  if (Object.keys(channel).length === 0) {
    throw new SubstackInsightsError("rss_invalid", "The response is not a recognizable RSS feed.");
  }

  const posts = ensureArray(channel.item as XmlRecord | XmlRecord[] | undefined).map((raw) => {
    const item = record(raw);
    const link = scalar(item.link);
    const guid = scalar(item.guid) || link;
    const title = scalar(item.title) || "Untitled";
    const html =
      scalar(item["content:encoded"]) || scalar(item.description) || scalar(item["content"]);
    const publishedAt = normalizeDate(scalar(item.pubDate) || scalar(item["dc:date"]));
    const canonicalUrl = link || null;
    const slug = canonicalUrl ? slugFromUrl(canonicalUrl) : null;
    const categories = ensureArray(item.category as unknown[] | undefined)
      .map(scalar)
      .filter((entry): entry is string => Boolean(entry));
    const remoteKey = guid || canonicalUrl || `${title}:${publishedAt ?? "unknown"}`;

    return {
      remoteId: `rss:${sha256(remoteKey).slice(0, 24)}`,
      slug,
      status: "published" as const,
      title,
      subtitle: nullIfEmpty(scalar(item.description) ? stripHtml(scalar(item.description) ?? "") : null),
      subject: title,
      contentHtml: html || null,
      contentText: html ? stripHtml(html) : null,
      contentMarkdown: null,
      documentJson: null,
      audience: null,
      emailAudience: null,
      canonicalUrl,
      publishedAt,
      scheduledAt: null,
      metadata: {
        guid: guid || null,
        author: scalar(item["dc:creator"]) || scalar(item.author) || null,
        categories,
        enclosure: item.enclosure ?? null,
      },
      source: "rss" as const,
    };
  });

  return { title: nullIfEmpty(scalar(channel.title)), posts };
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    nbsp: " ",
    quot: '"',
    rdquo: "”",
    rsquo: "’",
    lt: "<",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function record(value: unknown): XmlRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlRecord)
    : {};
}

function scalar(value: unknown): string | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as XmlRecord;
    return asString(object["#text"] ?? object["__cdata"] ?? null);
  }
  return asString(value);
}

function normalizeDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function slugFromUrl(value: string): string | null {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    const postIndex = parts.indexOf("p");
    return postIndex >= 0 ? (parts[postIndex + 1] ?? null) : (parts.at(-1) ?? null);
  } catch {
    return null;
  }
}
