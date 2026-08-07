# Operations guide

## Configure

Copy `.env.example` to `.env`, set a publication origin, and keep the database path local:

```dotenv
SUBSTACK_PUBLICATION_URL=https://your-publication.substack.com
SUBSTACK_INSIGHTS_DB_PATH=./data/substack-insights.sqlite
```

No Substack credential is accepted or needed.

## Commands

```bash
npm run dev -- status   # configuration and local ledger summary
npm run dev -- sync     # import public RSS
npm run dev -- serve    # start MCP over stdio
```

For production-like use, build first and run `node dist/src/cli.js serve`.

## Synchronization

RSS synchronization is safe to repeat. Each run is recorded; unchanged content reuses its digest and does not create another version. Schedule `node dist/src/cli.js sync` with a local job runner if you need periodic snapshots.

Use only a publication you own, administer, or have permission to archive. If a publisher removes public content, decide whether your retention obligations require deleting the corresponding local record.

## Official analytics snapshots

Install Substack's official MCP separately in the same client. Have the agent match official post identifiers, URLs, slugs, or exact titles to the local ledger and call `record_metric_snapshot` once per observation.

Never guess a missing field. Every call should include only observed values and, when available, the observation time. Repeating an identical source/timestamp updates that same observation; a new timestamp creates history.

## Backups

The database runs in WAL mode and is restricted to the current user. For a consistent backup, stop the server and copy the SQLite file together with `-wal` and `-shm` companions, or use SQLite's online backup command.

## Release checks

```bash
npm ci
npm run check
npm test
npm run build
npm audit --audit-level=high
node dist/src/cli.js status
```

CI runs the same checks on supported Node.js versions.
