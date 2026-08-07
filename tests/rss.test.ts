import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parsePublicationRss } from "../src/substack/rss.js";

describe("parsePublicationRss", () => {
  it("retains exact HTML and derives searchable plain text", () => {
    const xml = readFileSync(new URL("./fixtures/feed.xml", import.meta.url), "utf8");
    const feed = parsePublicationRss(xml, "https://example.substack.com");

    expect(feed.title).toBe("Test Publication");
    expect(feed.posts).toHaveLength(2);
    expect(feed.posts[0]?.slug).toBe("first-post");
    expect(feed.posts[0]?.contentHtml).toContain("complete <strong>sent</strong>");
    expect(feed.posts[0]?.contentText).toContain("complete sent content");
    expect(feed.posts[0]?.publishedAt).toBe("2026-08-06T14:00:00.000Z");
  });
});
