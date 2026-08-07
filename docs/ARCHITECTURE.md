# Architecture

Substack Insights MCP is a local stdio server with a deliberately narrow external boundary.

```text
public /feed ──► RSS normalizer ──► SQLite content ledger
                                           ▲
official MCP ──► agent ──► metric tool ─────┤
                                           │
local Markdown ──► immutable versioner ─────┘
                                           │
                              deterministic analytics
                                           │
                                      MCP stdio tools
```

## Trust boundaries

- `src/substack/rss.ts` is the only Substack network adapter. It performs an unauthenticated `GET` against the configured publication's public feed.
- OAuth for Substack's official MCP remains inside the user's MCP client. This server receives only metric values deliberately passed to `record_metric_snapshot`.
- SQLite and all derived data remain local. The server exposes stdio only and opens no listening socket.
- There is no publishing adapter, cookie parser, private endpoint, browser automation, or subscriber-level data model.

## Storage model

- `publications`: configured publication identity.
- `posts`: canonical identity, status, dates, and latest-version pointer.
- `post_versions`: immutable content, metadata, and SHA-256 digest.
- `metric_snapshots`: append-only observations with source and capture time.
- `sync_runs`: synchronization outcome and freshness.
- `audit_events`: local changes and provenance trail.

RSS items reconcile by canonical URL or slug so repeated syncs do not duplicate posts. A content digest prevents duplicate versions while preserving meaningful upstream changes.

## Analytics

Analytics are pure derivations over the latest snapshot selected for each post. Raw observations are retained, so formulas can be audited and recomputed. Correlations require at least three measured posts and return `null` when variance is zero.

## Compatibility

The server uses the official TypeScript MCP SDK and stdio transport. Its integration test launches the real CLI, negotiates MCP, lists every tool, records an `official_mcp` snapshot, and verifies the derived performance response.
