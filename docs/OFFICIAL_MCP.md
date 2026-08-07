# Official MCP snapshot workflow

Substack Insights MCP complements rather than replaces [Substack's official MCP](https://support.substack.com/hc/en-us/articles/50834026608916-How-to-connect-Substack-to-your-AI-Assistant).

## Division of responsibility

| Connector | Responsibility |
|---|---|
| Substack official MCP | OAuth-protected current analytics such as post performance, subscribers, revenue, and retention |
| Substack Insights MCP | Public content archive, immutable local history, timestamped metric snapshots, and deterministic comparisons |

The official connector currently requires an eligible Bestseller publication and Admin access. Its OAuth credentials remain inside the MCP client.

## Recommended agent sequence

1. Run `sync_publication` to refresh canonical posts from RSS.
2. Ask the official connector for the selected posts and measurement fields.
3. Match each official result to a local post by canonical URL, slug, remote identifier, or exact title.
4. Call `record_metric_snapshot` with only fields actually returned by the official connector.
5. Use `get_post_performance`, `compare_posts`, or `analyze_content_patterns` locally.

## Provenance rules

- Source is always stored as `official_mcp`.
- `capturedAt` should represent observation time, not publication time.
- Unknown values stay absent or `null`; zero means an observed zero.
- Keep snapshots from different dates so performance maturation remains visible.

This bridge is intentionally agent-orchestrated. One MCP server does not receive the other's access token or invoke it behind the user's back.
