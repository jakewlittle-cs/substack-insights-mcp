import { describe, expect, it } from "vitest";

import { Store } from "../src/database.js";

describe("Store", () => {
  it("keeps immutable content versions and audit events", () => {
    const store = new Store(":memory:");
    const publication = store.ensurePublication("https://example.substack.com", "Example");
    const draft = store.createLocalDraft(publication.id, {
      title: "Draft",
      contentMarkdown: "First body",
      contentText: "First body",
      metadata: { format: "markdown" },
      source: "local",
    });
    const updated = store.updateLocalDraft(draft.id, { contentMarkdown: "Second body" });

    expect(updated.version?.version).toBe(2);
    expect(updated.version?.digest).not.toBe(draft.version?.digest);
    expect(store.listPostVersions(updated.id).map((version) => version.version)).toEqual([2, 1]);
    expect(store.listAuditEvents(publication.id, { postId: updated.id })).toHaveLength(2);

    store.close();
  });

  it("reconciles RSS and manual records by canonical URL", () => {
    const store = new Store(":memory:");
    const publication = store.ensurePublication("https://example.substack.com");
    const rss = store.upsertPost({
      publicationId: publication.id,
      remoteId: "rss:abc",
      slug: "same-post",
      status: "published",
      title: "Same post",
      canonicalUrl: "https://example.substack.com/p/same-post",
      source: "rss",
    });
    const manual = store.upsertPost({
      publicationId: publication.id,
      remoteId: "123",
      slug: "same-post",
      status: "published",
      title: "Same post",
      canonicalUrl: "https://example.substack.com/p/same-post",
      source: "manual",
    });

    expect(manual.post.id).toBe(rss.post.id);
    expect(manual.post.remoteId).toBe("123");
    expect(store.listPosts(publication.id)).toHaveLength(1);
    store.close();
  });
});
